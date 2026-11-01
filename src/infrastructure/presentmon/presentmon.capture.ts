import { elevatedCommand, presentMonFailure } from './elevated-command.ts';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RESOURCES } from '../paths/resources.ts';
import type {
  FrameCaptureRequest,
  CaptureProgress,
  FrameCaptureSource,
} from '../../application/ports/frame-capture.port.ts';
import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import { parsePresentMonCsv } from './presentmon-csv.parser.ts';

const execFileAsync = promisify(execFile);

const PRESENTMON_PATH = RESOURCES.presentMon();

/** PresentMon отвечает этим кодом, когда ему не хватает прав на ETW-сессию. */
const EXIT_NEEDS_ELEVATION = 6;

/** Запас поверх заказанной длительности: PresentMon ещё дописывает файл. */
const TIMEOUT_MARGIN_MS = 20_000;

/**
 * Имя сессии трассировки.
 *
 * Задаём своё, а не берём умолчание: остановить сессию можно только назвав её,
 * и без этого кнопка «остановить» гасила бы чужую запись, а не нашу.
 */
const SESSION_NAME = 'kadroskop';

/** Сколько ждём, пока идущая запись согласится остановиться. */
const STOP_TIMEOUT_MS = 30_000;

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
  /**
   * Просит идущую запись остановиться.
   *
   * Своего процесса у нас нет — он поднят через UAC и нам не принадлежит.
   * Поэтому запускаем второй экземпляр PresentMon: он гасит сессию по имени и
   * выходит, а первый дописывает файл и завершается сам. Прав это тоже требует,
   * поэтому запрос UAC появится во второй раз.
   */
  async stop(): Promise<void> {
    await ensureInstalled();
    await runCapture(
      ['--session_name', SESSION_NAME, '--terminate_existing_session'],
      STOP_TIMEOUT_MS,
    );
  }

  async capture(request: FrameCaptureRequest): Promise<FrameCapture> {
    request.onProgress?.('starting');
    await ensureInstalled();

    const workDir = await mkdtemp(join(tmpdir(), 'kadroskop-capture-'));
    // Когда путь задан снаружи, PresentMon пишет сразу туда: копировать файл
    // из-под повышения прав было бы лишним шагом с лишними правами.
    const keepRaw = request.rawCsvPath !== undefined;
    const csvPath = request.rawCsvPath ?? join(workDir, 'frames.csv');
    const args = buildArgs(request, csvPath);
    const timeoutMs = request.seconds * MS_IN_SECOND + TIMEOUT_MARGIN_MS;

    let finished = false;
    let confirmed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inspect = async () => {
      try {
        const file = await open(csvPath, 'r');
        try {
          const buffer = Buffer.alloc(64 * 1024);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          const lines = buffer.toString('utf8', 0, bytesRead).split(/\r?\n/).filter(Boolean);
          if (
            !finished &&
            !confirmed &&
            lines.length > 1 &&
            lines[0]?.includes('Application') &&
            lines[1]!.includes(',')
          ) {
            confirmed = true;
            request.onProgress?.('recording');
          }
        } finally {
          await file.close();
        }
      } catch {
        /* Файл появится после запуска и первых кадров. */
      }
      if (!finished && !confirmed)
        timer = setTimeout(() => {
          void inspect();
        }, 500);
    };
    void inspect();
    try {
      await runCapture(args, timeoutMs, request.onProgress);
      finished = true;
      clearTimeout(timer);
      request.onProgress?.('analyzing');
      return parsePresentMonCsv(await readFile(csvPath, 'utf8'), {
        timeColumnIsQpcMs: true,
      });
    } finally {
      finished = true;
      clearTimeout(timer);
      if (!keepRaw) {
        await rm(workDir, { recursive: true, force: true });
      }
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
    '--session_name',
    SESSION_NAME,
    '--timed',
    String(request.seconds),
    '--terminate_after_timed',
    // Запись целого матча: длину заранее не знает никто, а PresentMon умеет
    // следить за жизнью процесса сам.
    ...(request.stopWhenGameExits === true ? ['--terminate_on_proc_exit'] : []),
    // Без этого PresentMon 2.x пишет собственную статистику в консоль и мешает
    // читать наши сообщения.
    '--no_console_stats',
    // Разбивка кадра по CPU и GPU есть только в метриках второй версии; без неё
    // на вопрос «во что упёрлись» ответить нечем.
    '--v2_metrics',
    // Оставшаяся от прошлого падения сессия иначе не даст стартовать новой.
    '--stop_existing_session',
    // Абсолютное время по счётчику производительности: без него кадры не
    // положить на одну ось с показаниями сенсоров.
    '--qpc_time_ms',
  ];
}

/**
 * Сначала пробуем запустить напрямую: если приложение уже запущено с правами
 * администратора, запроса UAC не будет вовсе. И только получив отказ по правам,
 * поднимаемся через RunAs — тогда пользователь увидит ровно один запрос.
 */
async function runCapture(
  args: readonly string[],
  timeoutMs: number,
  onProgress?: (phase: CaptureProgress) => void,
): Promise<void> {
  try {
    const running = execFileAsync(PRESENTMON_PATH, [...args], {
      timeout: timeoutMs,
      windowsHide: true,
    });
    running.child.once('spawn', () => onProgress?.('waiting-frames'));
    await running;
    return;
  } catch (error) {
    if (!needsElevation(error)) throw presentMonFailure(error);
  }

  try {
    onProgress?.('awaiting-permission');
    await runElevated(args, timeoutMs, onProgress);
  } catch (error) {
    throw presentMonFailure(error);
  }
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
async function runElevated(
  args: readonly string[],
  timeoutMs: number,
  onProgress?: (phase: CaptureProgress) => void,
): Promise<void> {
  const command = elevatedCommand(PRESENTMON_PATH, args);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];

  const elevated = execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeout: timeoutMs, windowsHide: true, env },
  );
  let output = '';
  elevated.child.stdout?.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-256);
    if (output.includes('KADROSKOP_STARTED')) {
      onProgress?.('waiting-frames');
      output = '';
    }
  });
  await elevated;
}
