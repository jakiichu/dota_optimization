import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function ensureSettingsAppsClosed(): Promise<void> {
  const { stdout } = await execute('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    windowsHide: true,
    timeout: 10_000,
  });
  if (/^"(?:dota2|steam)\.exe"/im.test(stdout)) {
    throw new Error(
      'Закройте Dota и полностью завершите Steam через его меню, затем повторите перенос. Это нужно, чтобы они не перезаписали настройки.',
    );
  }
}
