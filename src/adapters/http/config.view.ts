import type { ConfigNote, ConfigAnalysis } from '../../domain/gameconfig/config-analysis.ts';
import { IMPACT_LABEL, IMPACT_SHORT, type CvarImpact } from '../../domain/gameconfig/cvar-knowledge.ts';
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
  /** Осторожная формулировка влияния — та самая, с «возможно». */
  readonly impactLabel: string;
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

const UNKNOWN_LABEL = 'не знаем, что это делает';

export function toConfigView(state: GameConfigState): ConfigView {
  const settings = (state.config?.settings ?? []).map(toSettingView);

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
    known,
  };
}

function toTallyView(entry: ConfigAnalysis['tally'][number]): ConfigTallyView {
  return {
    impact: entry.impact,
    label: entry.impact === 'unknown' ? 'не знаем' : IMPACT_SHORT[entry.impact],
    count: entry.count,
  };
}
