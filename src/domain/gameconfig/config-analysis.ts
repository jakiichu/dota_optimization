import type { CvarImpact } from './cvar-knowledge.ts';
import { findDuplicates, findSetting, type CvarSetting, type GameConfig } from './game-config.ts';

/**
 * Разбор чужого конфига.
 *
 * Такие файлы ходят по интернету списками в семьдесят строк без единого
 * объяснения. Человек вставляет их целиком и не знает, какие строки купили ему
 * кадры, какие изменили игру, а какие не делают ничего.
 *
 * Здесь не выносится приговор «хороший конфиг или плохой»: это решается
 * замером, а не чтением. Задача — показать состав и назвать то, что спорит с
 * измеренным на этой машине.
 */

export type NoteSeverity = 'critical' | 'warning' | 'info';

export interface ConfigNote {
  readonly severity: NoteSeverity;
  readonly title: string;
  readonly detail: string;
  readonly remediation: readonly string[];
}

export interface ImpactTally {
  readonly impact: CvarImpact | 'unknown';
  readonly count: number;
}

export interface ConfigAnalysis {
  readonly path: string;
  readonly settingCount: number;
  readonly tally: readonly ImpactTally[];
  readonly notes: readonly ConfigNote[];
  /** Настройки, о которых мы ничего не знаем. */
  readonly unknown: readonly CvarSetting[];
}

/**
 * Что уже измерено на этой машине.
 *
 * Без этого конфиг можно только пересказать. С этим — сопоставить: строка,
 * снимающая потолок кадров, безобидна на мониторе с запасом и вредна там, где
 * игра и так не попадает в развёртку.
 */
export interface MeasuredContext {
  /** Доля времени в кадрах кратно длиннее базового ритма, 0…1. */
  readonly pacingTimeShare: number | null;
  /** Во что упиралась игра в последней записи. */
  readonly bottleneck: 'gpu' | 'cpu' | 'mixed' | 'limited' | 'unknown' | null;
}

/** Доля рваного ритма, выше которой снятый потолок кадров становится проблемой. */
const RAGGED_PACING_SHARE = 0.05;

export function analyzeGameConfig(
  config: GameConfig,
  measured: MeasuredContext = { pacingTimeShare: null, bottleneck: null },
): ConfigAnalysis {
  const notes: ConfigNote[] = [];
  notes.push(...noteFrameCap(config, measured));
  notes.push(...noteBottleneckMismatch(config, measured));
  notes.push(...noteNonPerformance(config));
  notes.push(...noteDuplicates(config));
  notes.push(...noteUnparsed(config));

  return {
    path: config.path,
    settingCount: config.settings.length,
    tally: tally(config),
    notes,
    unknown: config.settings.filter((setting) => setting.impact === null),
  };
}

/**
 * Снятый потолок кадров.
 *
 * Самая частая строка в чужих конфигах и самая спорная: она не ускоряет игру,
 * а убирает ограничение. Если кадры и так не попадают в развёртку, снятый
 * потолок ровно эту проблему и усиливает.
 */
function noteFrameCap(config: GameConfig, measured: MeasuredContext): ConfigNote[] {
  const capped = findSetting(config, 'fps_max');
  if (capped === undefined || Number(capped.value) !== 0) return [];

  const ragged =
    measured.pacingTimeShare !== null && measured.pacingTimeShare >= RAGGED_PACING_SHARE;

  return [
    {
      severity: ragged ? 'critical' : 'warning',
      title: 'Конфиг снимает потолок кадров',
      detail: ragged
        ? `Строка ${capped.line}: fps_max 0. В последней записи ` +
          `${((measured.pacingTimeShare ?? 0) * 100).toFixed(0)}% времени ушло в кадры ` +
          'кратно длиннее обычного — игра не попадает в развёртку. Снятый потолок ' +
          'усиливает именно это: чем больше кадров игра пытается выдать, тем чаще ' +
          'промахивается мимо развёртки.'
        : `Строка ${capped.line}: fps_max 0 снимает потолок кадров. Само по себе ` +
          'это не ускоряет игру, а убирает ограничение — растут нагрев и шум, а ' +
          'ровность кадров может ухудшиться.',
      remediation: [
        'Поставить потолок чуть ниже частоты монитора и записать сессию.',
        'Сравнить записи: разницу считает раздел «Сравнение», а не ощущения.',
        'Конфиг выполняется при каждом запуске игры — правка через консоль ' +
          'откатится после перезапуска, менять надо файл.',
      ],
    },
  ];
}

/**
 * Конфиг снимает работу не с того устройства.
 *
 * Большинство ходящих по сети конфигов разгружают видеокарту. Если игра
 * упирается в процессор, половина строк не даст ничего — и человек будет
 * уверен, что «выжал всё», глядя на неизменившиеся кадры.
 */
function noteBottleneckMismatch(
  config: GameConfig,
  measured: MeasuredContext,
): ConfigNote[] {
  if (measured.bottleneck !== 'cpu') return [];

  const gpuOnly = config.settings.filter((setting) => setting.impact === 'gpu').length;
  const cpuAny = config.settings.filter(
    (setting) => setting.impact === 'cpu' || setting.impact === 'both',
  ).length;
  if (gpuOnly <= cpuAny) return [];

  return [
    {
      severity: 'info',
      title: 'Конфиг разгружает в основном видеокарту',
      detail:
        `${gpuOnly} строк снимают работу с видеокарты и только ${cpuAny} — с процессора, ` +
        'а в последней записи игра упиралась именно в процессор. Часть настроек на ' +
        'этой машине может не дать ничего.',
      remediation: [
        'Проверять по одной группе за раз и мерить: разом применённый конфиг не ' +
          'скажет, что именно помогло.',
        'В первую очередь смотреть на частицы, тени и окружение — они грузят и процессор.',
      ],
    },
  ];
}

/** Строки, которые меняют игру, а не её скорость. */
function noteNonPerformance(config: GameConfig): ConfigNote[] {
  const changed = config.settings.filter(
    (setting) => setting.impact === 'gameplay' || setting.impact === 'none',
  );
  if (changed.length === 0) return [];

  return [
    {
      severity: 'info',
      title: 'Часть строк меняет игру, а не её скорость',
      detail:
        'Эти строки кадров не добавляют и не отнимают — они меняют то, что вы видите ' +
        'и как играете: ' +
        changed
          .map((setting) => `${setting.name} ${setting.value} (строка ${setting.line})`)
          .join('; ') +
        '.',
      remediation: [
        'Это не ошибка. Но и не источник кадров: решайте по вкусу, а не по ' +
          'обещаниям того, у кого вы взяли конфиг.',
      ],
    },
  ];
}

function noteDuplicates(config: GameConfig): ConfigNote[] {
  const duplicates = findDuplicates(config);
  if (duplicates.length === 0) return [];

  return duplicates.map((group) => {
    const last = group.at(-1);
    return {
      severity: 'warning' as const,
      title: `Настройка ${group[0]?.name ?? ''} задана несколько раз`,
      detail:
        `Она встречается в строках ${group.map((setting) => setting.line).join(', ')}. ` +
        'Движок читает файл сверху вниз, поэтому в силе окажется последняя: ' +
        `${last?.name ?? ''} ${last?.value ?? ''}. Остальные не сделают ничего.`,
      remediation: ['Оставить одну строку, чтобы значение не зависело от порядка.'],
    };
  });
}

function noteUnparsed(config: GameConfig): ConfigNote[] {
  if (config.unparsed.length === 0) return [];

  return [
    {
      severity: 'warning',
      title: 'Некоторые строки разобрать не вышло',
      detail:
        'Они не похожи на пару «настройка значение»: ' + config.unparsed.join('; ') + '.',
      remediation: [
        'Проверьте их глазами: движок такие строки, скорее всего, тоже пропустит, ' +
          'и то, ради чего они написаны, не работает.',
      ],
    },
  ];
}

function tally(config: GameConfig): ImpactTally[] {
  const counts = new Map<CvarImpact | 'unknown', number>();
  for (const setting of config.settings) {
    const key = setting.impact ?? 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([impact, count]) => ({ impact, count }))
    .sort((left, right) => right.count - left.count);
}
