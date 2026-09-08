import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  FrameCaptureRequest,
  FrameCaptureSource,
} from '../../application/ports/frame-capture.port.ts';
import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import { parsePresentMonCsv } from './presentmon-csv.parser.ts';

const execFileAsync = promisify(execFile);

const PRESENTMON_PATH = fileURLToPath(
  new URL('../../../tools/presentmon/PresentMon.exe', import.meta.url),
);

/** PresentMon отвечает этим кодом, когда ему не хватает прав на ETW-сессию. */
const EXIT_NEEDS_ELEVATION = 6;

/** Запас поверх заказанной длительности: PresentMon ещё дописывает файл. */
const TIMEOUT_MARGIN_MS = 20_000;

const MS_IN_SECOND = 1000;

export class PresentMonMissingError extends Error {
  constructor() {
    super(
      `PresentMon не найден: ${PRESENTMON_PATH}\n` +
        'Скачайте PresentMon-x64.exe с github.com/GameTechDev/PresentMon/releases ' +
        'и положите его туда под именем PresentMon.exe.',
    );
    this.name = 'PresentMonMissingError';
  }
}

/**
 * Запись кадров через PresentMon.
 *
 * Запись ограничена по времени и завершается сама. Это не только про удобство:
 * запущенный с повышением процесс нам не принадлежит, и убить его мы не можем —
 * значит, он обязан знать, когда остановиться, сам.
 */
export class PresentMonCapture implements FrameCaptureSource {
  async capture(request: FrameCaptureRequest): Promise<FrameCapture> {
    await ensureInstalled();

    const workDir = await mkdtemp(join(tmpdir(), 'frameloss-capture-'));
    const csvPath = join(workDir, 'frames.csv');
    const args = buildArgs(request, csvPath);
    const timeoutMs = request.seconds * MS_IN_SECOND + TIMEOUT_MARGIN_MS;

    try {
      await runCapture(args, timeoutMs);
      return parsePresentMonCsv(await readFile(csvPath, 'utf8'));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

async function ensureInstalled(): Promise<void> {
  try {
    await access(PRESENTMON_PATH, constants.X_OK);
  } catch {
    throw new PresentMonMissingError();
  }
}

function buildArgs(request: FrameCaptureRequest, csvPath: string): string[] {
  return [
    '--process_name',
    request.processName,
    '--output_file',
    csvPath,
    '--timed',
    String(request.seconds),
    '--terminate_after_timed',
    // Без этого PresentMon 2.x пишет собственную статистику в консоль и мешает
    // читать наши сообщения.
    '--no_console_stats',
    // Разбивка кадра по CPU и GPU есть только в метриках второй версии; без неё
    // на вопрос «во что упёрлись» ответить нечем.
    '--v2_metrics',
    // Оставшаяся от прошлого падения сессия иначе не даст стартовать новой.
    '--stop_existing_session',
  ];
}

/**
 * Сначала пробуем запустить напрямую: если приложение уже запущено с правами
 * администратора, запроса UAC не будет вовсе. И только получив отказ по правам,
 * поднимаемся через RunAs — тогда пользователь увидит ровно один запрос.
 */
async function runCapture(args: readonly string[], timeoutMs: number): Promise<void> {
  try {
    await execFileAsync(PRESENTMON_PATH, [...args], { timeout: timeoutMs, windowsHide: true });
    return;
  } catch (error) {
    if (!needsElevation(error)) throw error;
  }

  await runElevated(args, timeoutMs);
}

function needsElevation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? (error as { code: unknown }).code : undefined;
  return code === EXIT_NEEDS_ELEVATION;
}

/**
 * Повышение прав через `Start-Process -Verb RunAs`.
 *
 * Именно поэтому запись пишется в файл, а не в stdout: у процесса, поднятого
 * через UAC, свои дескрипторы, и перехватить его вывод нельзя.
 */
async function runElevated(args: readonly string[], timeoutMs: number): Promise<void> {
  const argumentList = args.map(quoteForPowerShell).join(', ');
  const command =
    `Start-Process -FilePath ${quoteForPowerShell(PRESENTMON_PATH)} ` +
    `-ArgumentList ${argumentList} -Verb RunAs -WindowStyle Hidden -Wait`;

  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeout: timeoutMs, windowsHide: true },
  );
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
