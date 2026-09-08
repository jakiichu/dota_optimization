import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const BOM = '\uFEFF';

export class ExternalProcessError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message, { cause: stderr });
    this.name = 'ExternalProcessError';
    this.stderr = stderr;
  }
}

export interface JsonProcessOptions {
  /** Как назвать источник в тексте ошибки. */
  readonly label: string;
  readonly timeoutMs?: number;
}

/**
 * Запускает процесс, который пишет JSON в файл, и возвращает разобранный результат.
 *
 * Обмен идёт через файл, а не через stdout: консоль Windows работает в локальной
 * кодовой странице, и кириллица (имена адаптеров, схем питания) через неё
 * приходит битой. Файл в UTF-8 снимает вопрос целиком — а заодно позволяет
 * процессу писать в stderr диагностику, не ломая разбор.
 */
export async function runJsonProducingProcess(
  executable: string,
  buildArgs: (outputPath: string) => readonly string[],
  options: JsonProcessOptions,
): Promise<unknown> {
  const workDir = await mkdtemp(join(tmpdir(), 'frameloss-'));
  const outputPath = join(workDir, 'output.json');

  try {
    await execFileAsync(executable, [...buildArgs(outputPath)], {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    await rm(workDir, { recursive: true, force: true });
    throw new ExternalProcessError(
      `Сбор данных не удался: ${options.label}`,
      stderrOf(error),
    );
  }

  try {
    const raw = await readFile(outputPath, 'utf8');
    return JSON.parse(raw.startsWith(BOM) ? raw.slice(BOM.length) : raw);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function stderrOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) {
    return error instanceof Error ? error.message : String(error);
  }
  return String((error as { stderr: unknown }).stderr).trim();
}
