import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runJsonProducingProcess } from '../process/json-process.runner.ts';

/**
 * Записать текстовый файл на настоящий рабочий стол пользователя.
 *
 * Windows может перенести Desktop в OneDrive. `%USERPROFILE%\\Desktop` тогда
 * остаётся существовать, но человек файла там не увидит, поэтому путь спрашиваем
 * у системы. Разрешение можно подменить в тесте, чтобы не трогать рабочий стол.
 */
export async function writeTextToDesktop(
  prefix: string,
  extension: string,
  text: string,
  resolveDesktop: () => Promise<string> = desktopDirectory,
): Promise<string> {
  if (!/^[a-z0-9-]+$/i.test(prefix) || !/^[a-z0-9]+$/i.test(extension)) {
    throw new Error('Недопустимое имя файла для рабочего стола.');
  }
  const directory = await resolveDesktop();
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${prefix}-${timestamp()}.${extension}`);
  await writeFile(target, text, 'utf8');
  return target;
}

async function desktopDirectory(): Promise<string> {
  try {
    const value = await runJsonProducingProcess(
      'powershell.exe',
      (outputPath) => [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Environment]::GetFolderPath('Desktop') | ConvertTo-Json | ` +
          `Set-Content -LiteralPath ${psQuote(outputPath)} -Encoding UTF8`,
      ],
      { label: 'путь к рабочему столу', timeoutMs: 15_000 },
    );
    if (typeof value === 'string' && value.trim() !== '') return value;
  } catch {
    // Запасной путь лучше полного отказа от сохранения отчёта.
  }
  return join(homedir(), 'Desktop');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
