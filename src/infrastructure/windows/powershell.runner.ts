import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const POWERSHELL = 'powershell.exe';
const DEFAULT_TIMEOUT_MS = 60_000;
const BOM = '\uFEFF';

export class PowerShellError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message, { cause: stderr });
    this.name = 'PowerShellError';
    this.stderr = stderr;
  }
}

/**
 * Запускает скрипт, который пишет JSON в файл, и возвращает разобранный результат.
 *
 * Обмен идёт через файл, а не через stdout: консоль Windows работает в
 * локальной кодовой странице, и кириллица (имена адаптеров, схем питания) через
 * неё приходит битой. Файл в UTF-8 снимает вопрос целиком.
 */
export async function runJsonScript(
  scriptPath: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const workDir = await mkdtemp(join(tmpdir(), 'frameloss-'));
  const outputPath = join(workDir, 'snapshot.json');

  try {
    await execFileAsync(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-OutputPath',
        outputPath,
      ],
      { timeout: timeoutMs, windowsHide: true },
    );
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr)
        : '';
    await rm(workDir, { recursive: true, force: true });
    throw new PowerShellError(
      `Сбор данных не удался: ${scriptPath}`,
      stderr.trim(),
    );
  }

  try {
    const raw = await readFile(outputPath, 'utf8');
    return JSON.parse(raw.startsWith(BOM) ? raw.slice(BOM.length) : raw);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
