import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TransferSettingsFile } from '../../application/ports/account-controls.port.ts';

const FILES = new Set([
  'remote/cfg/dotakeys_personal.lst', 'remote/cfg/config.cfg', 'remote/cfg/autoexec.cfg',
  'remote/user_convars.vcfg', 'remote/user_keys.vcfg',
  'local/cfg/machine_convars.vcfg', 'local/cfg/video.txt',
  'remote/cfg/hero_grid_config.json', 'remote/cfg/hero_facet_config.cfg', 'remote/cfg/herobuilds.cfg',
  'remote/cfg/dota_armory_filters.txt', 'remote/cfg/dota_player_loadout_shuffle.txt',
  'remote/cfg/saved_sets.kv', 'remote/cfg/dota_player_scratchpad.txt',
  'remote/scripts/control_groups.txt', 'remote/scripts/item_suggest_preference.txt',
  'remote/scripts/dota_backpack_filters.txt', 'remote/scripts/lobby_settings.txt',
]);
export function isSettingsFile(path: string): boolean {
  const key = path.toLowerCase();
  return FILES.has(key) || /^local\/cfg\/user_(convars|keys)_\d+_slot\d+\.vcfg$/.test(key)
    || /^remote\/guides\/[^/]+\.build$/.test(key);
}

/** Не разрешаем выход из userdata или переход через junction/symlink. */
export async function checkedPath(root: string, path: string): Promise<string> {
  const absolute = resolve(root, path);
  const tail = relative(resolve(root), absolute);
  if (!tail || tail.startsWith('..') || isAbsolute(tail)) throw new Error('Недопустимый путь настроек.');
  let current = resolve(root);
  for (const segment of ['', ...tail.split(sep)]) {
    if (segment) current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Перенос через ссылки и junction не поддерживается.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}

export async function accountRoot(steamPath: string, id: string): Promise<string> {
  if (!/^\d+$/.test(id)) throw new Error('Профиль Steam указан неверно.');
  const root = await realpath(steamPath);
  return checkedPath(root, join('userdata', id, '570'));
}

export async function listSettings(root: string): Promise<TransferSettingsFile[]> {
  const files: TransferSettingsFile[] = [];
  for (const directory of ['local/cfg', 'remote', 'remote/cfg', 'remote/scripts', 'remote/guides']) {
    const folder = await checkedPath(root, directory);
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (!isSettingsFile(path)) continue;
      const absolute = await checkedPath(root, path);
      const info = await lstat(absolute);
      if (!info.isFile()) throw new Error(`Ожидался файл настроек: ${path}`);
      if (info.size > 16 * 1024 * 1024) throw new Error(`Слишком большой файл настроек: ${path}`);
      files.push({ path, sizeBytes: info.size });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
