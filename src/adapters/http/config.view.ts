import type { ConfigNote, ConfigAnalysis } from '../../domain/gameconfig/config-analysis.ts';
import { IMPACT_LABEL, type CvarImpact } from '../../domain/gameconfig/cvar-knowledge.ts';
import {
  inGameSetting,
  type InGameSetting,
  type SettingNames,
} from '../../domain/gameconfig/setting-names.ts';
import { valueKindOf, type CvarValueKind } from '../../domain/gameconfig/cvar-value.ts';
import type { GameConfigState } from '../../application/use-cases/manage-game-config.ts';

/**
 * Конфиг для интерфейса.
 *
 * Каждая строка приходит на экран уже с человеческим именем и объяснением:
 * список из семидесяти переменных без подписей — это ровно тот файл из
 * интернета, от которого мы человека и уводим.
 *
 * Незнакомая настройка приходит помеченной как незнакомая. Придумать ей
 * описание было бы худшим из возможных решений: человек оставит вредное,
 * поверив нам на слово.
 */

export interface ConfigSettingView {
  readonly name: string;
  readonly value: string;
  readonly line: number;
  /** Чем править: переключателем, числом, цветом или обычным полем. */
  readonly kind: CvarValueKind;
  /** Что настройка делает. `null` — мы про неё не знаем. */
  readonly what: string | null;
  /** Чем за неё платят. `null` — ничем или неизвестно. */
  readonly cost: string | null;
  readonly impact: CvarImpact | 'unknown';
  /** Чего касается настройка: «считает процессор», «рисует видеокарта». */
  readonly impactLabel: string;
  /**
   * Как эта строка называется в меню игры.
   *
   * `null` — либо в меню её нет вовсе (таких в autoexec большинство: ради них
   * файл и заводят), либо мы не уверены в соответствии и молчим.
   */
  readonly inGame: InGameSetting | null;
  readonly known: boolean;
}

export interface ConfigTallyView {
  readonly impact: CvarImpact | 'unknown';
  readonly label: string;
  readonly count: number;
}

export interface ConfigView {
  /** Куда игра смотрит за конфигом. `null` — игру найти не удалось. */
  readonly path: string | null;
  readonly exists: boolean;
  readonly text: string;
  readonly settingCount: number;
  readonly settings: readonly ConfigSettingView[];
  readonly unparsed: readonly string[];
  readonly notes: readonly ConfigNote[];
  readonly tally: readonly ConfigTallyView[];
  /** Куда уехала прежняя версия при последней правке. */
  readonly backupPath: string | null;
}

const UNKNOWN_LABEL = 'мы не знаем, что это делает';

export function toConfigView(state: GameConfigState, names: SettingNames): ConfigView {
  const settings = (state.config?.settings ?? []).map((setting) =>
    toSettingView(setting, names),
  );

  return {
    path: state.path,
    exists: state.exists,
    text: state.text,
    settingCount: settings.length,
    settings,
    unparsed: state.config?.unparsed ?? [],
    notes: state.analysis?.notes ?? [],
    tally: (state.analysis?.tally ?? []).map(toTallyView),
    backupPath: state.backupPath,
  };
}

function toSettingView(
  setting: NonNullable<GameConfigState['config']>['settings'][number],
  names: SettingNames,
): ConfigSettingView {
  const known = setting.impact !== null;
  return {
    name: setting.name,
    value: setting.value,
    line: setting.line,
    kind: valueKindOf(setting.name, setting.value, known),
    what: setting.what,
    cost: setting.cost,
    impact: setting.impact ?? 'unknown',
    impactLabel: setting.impact === null ? UNKNOWN_LABEL : IMPACT_LABEL[setting.impact],
    inGame: inGameSetting(setting.name, names),
    known,
  };
}

function toTallyView(entry: ConfigAnalysis['tally'][number]): ConfigTallyView {
  return {
    impact: entry.impact,
    label: entry.impact === 'unknown' ? 'не знаем' : IMPACT_LABEL[entry.impact],
    count: entry.count,
  };
}
