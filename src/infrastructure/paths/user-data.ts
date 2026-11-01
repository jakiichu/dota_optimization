import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Данные пользователя не зависят от каталога сборки или способа запуска. */
export function sharedSessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['KADROSKOP_SESSIONS'];
  if (override?.trim()) return resolve(override);
  return join(env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'Кадроскоп', 'sessions');
}
