import type { Maybe } from '../snapshot/system-snapshot.ts';
import { describeCvar, type CvarImpact } from './cvar-knowledge.ts';

/**
 * Разбор конфига Dota.
 *
 * Формат простой: имя настройки, значение, необязательная точка с запятой.
 * Разбираем построчно и сохраняем номера строк — человеку нужно знать, где
 * именно в его файле лежит то, о чём мы говорим.
 */

export interface CvarSetting {
  readonly name: string;
  readonly value: string;
  /** Номер строки в файле, считая с единицы. */
  readonly line: number;
  readonly impact: CvarImpact | null;
  readonly what: Maybe<string>;
  readonly cost: Maybe<string>;
}

export interface GameConfig {
  readonly path: string;
  readonly settings: readonly CvarSetting[];
  /** Строки, которые разобрать не удалось. */
  readonly unparsed: readonly string[];
}

/** Комментарии в конфигах Valve. */
const COMMENT = '//';

export function parseGameConfig(path: string, text: string): GameConfig {
  const settings: CvarSetting[] = [];
  const unparsed: string[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = stripComment(raw).trim().replace(/;+$/, '').trim();
    if (line === '') return;

    // Имя, затем значение — которое может состоять из нескольких слов,
    // как у цветов: `dota_friendly_color 0 255 255`.
    const match = /^([A-Za-z_][A-Za-z0-9_.]*)\s+(.+)$/.exec(line);
    if (match === null) {
      unparsed.push(`строка ${index + 1}: ${line}`);
      return;
    }

    const name = match[1] ?? '';
    const info = describeCvar(name);
    settings.push({
      name,
      value: (match[2] ?? '').trim(),
      line: index + 1,
      impact: info?.impact ?? null,
      what: info?.what ?? null,
      cost: info === null || info.cost === '' ? null : info.cost,
    });
  });

  return { path, settings, unparsed };
}

function stripComment(line: string): string {
  const at = line.indexOf(COMMENT);
  return at === -1 ? line : line.slice(0, at);
}

export function findSetting(config: GameConfig, name: string): CvarSetting | undefined {
  const lowered = name.toLowerCase();
  // Побеждает последняя: движок выполняет строки по порядку.
  return [...config.settings].reverse().find((setting) => setting.name.toLowerCase() === lowered);
}

/** Настройки, заданные больше одного раза: сработает последняя. */
export function findDuplicates(config: GameConfig): readonly CvarSetting[][] {
  const byName = new Map<string, CvarSetting[]>();
  for (const setting of config.settings) {
    const key = setting.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), setting]);
  }
  return [...byName.values()].filter((group) => group.length > 1);
}
