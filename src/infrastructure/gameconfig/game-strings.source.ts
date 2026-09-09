import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SettingNames } from '../../domain/gameconfig/setting-names.ts';
import { readVpkFile, readVpkIndex } from '../steam/vpk.reader.ts';

/**
 * Настоящие названия настроек — из файлов самой игры.
 *
 * Свои описания у нас есть, но они наши. В меню Dota та же строка конфига
 * называется иначе, и человек ищет глазами именно меню: «Фауна», а не «зверьки
 * на карте». Придумать это соответствие нельзя — его можно только взять у игры.
 *
 * Язык берём тот же, на котором человек играет: подсказка «в игре это
 * называется Fauna» бесполезна тому, у кого меню на русском.
 *
 * Всё чтение — только чтение, и любая неудача означает, что подсказок просто не
 * будет: игра могла обновиться, архив поменять формат, языка не оказаться. Это
 * не повод не показать конфиг.
 */

/** Где внутри архива лежит локализация. */
const LOCALIZATION = (language: string): string =>
  `resource/localization/dota_${language}.txt`;

const FALLBACK_LANGUAGE = 'english';

/** Метка порядка байтов: файлы локализации Valve — UTF-16LE. */
const UTF16_BOM = 0xfeff;

/**
 * Только ключи настроек. В файле их четыре миллиона символов, и держать в
 * памяти чужие реплики ради полусотни названий незачем.
 */
const SETTING_TOKEN = /"(dota_settings_[A-Za-z0-9_]+)"\s*"([^"]*)"/g;

/**
 * Читает названия настроек для игры, чей конфиг лежит по этому пути.
 *
 * Путь к конфигу — `…/game/dota/cfg/autoexec.cfg`, отсюда и до архивов игры
 * рукой подать. Второй раз искать библиотеку Steam ради этого не станем.
 */
export async function readSettingNames(configPath: string): Promise<SettingNames> {
  const gameRoot = resolve(dirname(configPath), '..');
  const language = await readUiLanguage(join(dirname(configPath), 'boot.vcfg'));

  try {
    const dirPath = join(gameRoot, 'pak01_dir.vpk');
    const index = await readVpkIndex(dirPath);

    const entry =
      index.entries.get(LOCALIZATION(language)) ??
      index.entries.get(LOCALIZATION(FALLBACK_LANGUAGE));
    if (entry === undefined) return new Map();

    return parseTokens(decode(await readVpkFile(dirPath, index, entry)));
  } catch {
    // Архива нет, формат сменился, файл занят — подсказок просто не будет.
    return new Map();
  }
}

/**
 * Язык интерфейса игры.
 *
 * Лежит в `boot.vcfg` рядом с конфигом — это то, что игра прочитает при
 * следующем запуске, а не то, что когда-то выбрали в Steam.
 */
async function readUiLanguage(bootConfigPath: string): Promise<string> {
  try {
    const text = await readFile(bootConfigPath, 'utf8');
    const found = /"UILanguage"\s*"([a-z_]+)"/i.exec(text);
    return found?.[1]?.toLowerCase() ?? FALLBACK_LANGUAGE;
  } catch {
    return FALLBACK_LANGUAGE;
  }
}

function decode(data: Buffer): string {
  const hasBom = data.length >= 2 && data.readUInt16LE(0) === UTF16_BOM;
  return hasBom ? data.toString('utf16le', 2) : data.toString('utf8');
}

function parseTokens(text: string): SettingNames {
  const names = new Map<string, string>();
  for (const match of text.matchAll(SETTING_TOKEN)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined && value !== '') {
      names.set(key.toLowerCase(), value);
    }
  }
  return names;
}
