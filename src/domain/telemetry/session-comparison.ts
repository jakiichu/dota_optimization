import { compareScenes, describeScene, UNKNOWN_SCENE, type CaptureScene } from './capture-scene.ts';
import type { BottleneckKind, Percentiles } from './frame-metrics.ts';

/**
 * Сравнение двух записей.
 *
 * Половина советов инструмента звучит как «померь до и после». Без сравнения
 * этот совет невыполним: держать в голове шесть чисел и решать на глаз человек
 * не может, а «вроде плавнее стало» — не результат.
 *
 * Главная опасность здесь — объявить улучшением случайный разброс. Две записи
 * одной и той же конфигурации всегда различаются, поэтому изменение считается
 * настоящим только если оно больше и относительного, и абсолютного порога.
 */

/** Относительное изменение, ниже которого разницу считаем разбросом. */
const NOISE_SHARE = 0.05;

/** Абсолютный порог для времён, мс: доли миллисекунды человек не замечает. */
const NOISE_MS = 0.5;

/** Абсолютный порог для частоты статтеров, штук в минуту. */
const NOISE_STUTTERS_PER_MINUTE = 0.5;

/** Порог для FPS: кадр в секунду туда-сюда ничего не значит. */
const NOISE_FPS = 1;

/** Насколько записи могут различаться по длине, чтобы сравнение было честным. */
const MAX_DURATION_MISMATCH = 0.25;

/** Меньше этого числа статтеров — говорить об их частоте статистически нельзя. */
const MIN_STUTTERS_FOR_RATE = 3;

export interface SessionSummary {
  readonly id: string;
  readonly label: string;
  readonly application: string;
  readonly capturedAt: string;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly averageFps: number;
  readonly frameTime: Percentiles;
  readonly inputLatency: Percentiles | null;
  readonly stutterCount: number;
  readonly stuttersPerMinute: number;
  /** Доля времени в кадрах, кратно длиннее базового интервала. */
  readonly pacingTimeShare: number;
  readonly bottleneck: BottleneckKind;
  /** Что записывали: без этого сравнение выдаёт разницу сцен за результат. */
  readonly scene: CaptureScene;
}

export type Verdict = 'better' | 'worse' | 'same';

/**
 * Устойчивое имя метрики.
 *
 * Отдельно от ярлыка, потому что на метрику ссылаются снаружи: предсказание
 * рекомендации называет ту, которая должна сдвинуться. По ярлыку такая ссылка
 * ломалась бы от любой правки текста — молча и незаметно.
 */
export type MetricId =
  | 'fps'
  | 'frameTimeP50'
  | 'frameTimeP99'
  | 'frameTimeP999'
  | 'pacing'
  | 'stutters'
  | 'inputLatency';

export interface MetricDelta {
  readonly id: MetricId;
  readonly label: string;
  readonly unit: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  /** Доля изменения к исходному значению; 0, если сравнивать не с чем. */
  readonly share: number;
  readonly verdict: Verdict;
  readonly lowerIsBetter: boolean;
}

export interface SessionComparison {
  readonly before: SessionSummary;
  readonly after: SessionSummary;
  /**
   * Можно ли вообще делать вывод.
   *
   * `false` — числа посчитаны, но сравнивать их нельзя: сцены разные, и
   * разница между ними не имеет отношения к правке.
   */
  readonly comparable: boolean;
  readonly metrics: readonly MetricDelta[];
  readonly bottleneckChanged: boolean;
  readonly verdict: Verdict;
  /** Итог одной фразой. */
  readonly summary: string;
  /** Чем сравнение ограничено. Пусто — значит, оговорок нет. */
  readonly caveats: readonly string[];
}

interface MetricSpec {
  readonly id: MetricId;
  readonly label: string;
  readonly unit: string;
  readonly lowerIsBetter: boolean;
  readonly noise: number;
  readonly of: (session: SessionSummary) => number | null;
}

/**
 * Что сравниваем и в какую сторону лучше.
 *
 * Средний FPS стоит первым по привычке, но решают p99 и статтеры: именно их
 * человек ощущает как «дёргается».
 */
const METRICS: readonly MetricSpec[] = [
  {
    id: 'fps',
    label: 'Средний FPS',
    unit: '',
    lowerIsBetter: false,
    noise: NOISE_FPS,
    of: (session) => session.averageFps,
  },
  {
    id: 'frameTimeP50',
    label: 'Медиана кадра',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.frameTime.p50,
  },
  {
    id: 'frameTimeP99',
    label: 'p99 кадра',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.frameTime.p99,
  },
  {
    id: 'frameTimeP999',
    label: 'p99.9 кадра',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.frameTime.p999,
  },
  {
    id: 'pacing',
    label: 'Времени в рваном ритме',
    unit: '%',
    lowerIsBetter: true,
    noise: 1,
    of: (session) => session.pacingTimeShare * 100,
  },
  {
    id: 'stutters',
    label: 'Статтеров в минуту',
    unit: '',
    lowerIsBetter: true,
    noise: NOISE_STUTTERS_PER_MINUTE,
    of: (session) => session.stuttersPerMinute,
  },
  {
    id: 'inputLatency',
    label: 'Инпут-лаг p99',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.inputLatency?.p99 ?? null,
  },
];

/**
 * Метрики, по которым выносится общий вердикт: их человек и ощущает.
 *
 * Средний FPS сюда не входит намеренно: ограничитель кадров опускает его и
 * одновременно выравнивает ритм, и по FPS такая правка выглядела бы провалом.
 */
export const DECIDING_METRICS: ReadonlySet<MetricId> = new Set<MetricId>([
  'frameTimeP99',
  'stutters',
  'pacing',
]);

export function compareSessions(
  before: SessionSummary,
  after: SessionSummary,
): SessionComparison {
  const metrics = METRICS.map((spec) => compareMetric(spec, before, after)).filter(
    (metric): metric is MetricDelta => metric !== null,
  );

  const scenes = compareScenes(before.scene ?? UNKNOWN_SCENE, after.scene ?? UNKNOWN_SCENE);
  // Несравнимые записи не получают вердикта вовсе. Показать числа и приписать
  // к ним «стало лучше» — значит выдать разницу сцен за результат правки.
  const verdict = scenes.comparable ? overallVerdict(metrics) : 'same';

  return {
    before,
    after,
    metrics,
    comparable: scenes.comparable,
    bottleneckChanged: before.bottleneck !== after.bottleneck,
    verdict,
    summary: scenes.comparable
      ? describe(verdict, metrics)
      : 'Эти записи сравнивать нельзя.',
    caveats: [...scenes.reasons, ...collectCaveats(before, after)],
  };
}

function compareMetric(
  spec: MetricSpec,
  before: SessionSummary,
  after: SessionSummary,
): MetricDelta | null {
  const from = spec.of(before);
  const to = spec.of(after);
  // Метрику, которой нет хотя бы в одной записи, не сравниваем вовсе: подставив
  // ноль, мы бы получили красивое «улучшение» из ничего.
  if (from === null || to === null) return null;

  const delta = to - from;
  const share = from === 0 ? 0 : Math.abs(delta) / Math.abs(from);

  return {
    id: spec.id,
    label: spec.label,
    unit: spec.unit,
    before: from,
    after: to,
    delta,
    share,
    verdict: judge(delta, share, spec),
    lowerIsBetter: spec.lowerIsBetter,
  };
}

/** Изменение считается настоящим, только если прошло оба порога. */
function judge(delta: number, share: number, spec: MetricSpec): Verdict {
  if (Math.abs(delta) < spec.noise || share < NOISE_SHARE) return 'same';
  const improved = spec.lowerIsBetter ? delta < 0 : delta > 0;
  return improved ? 'better' : 'worse';
}

function overallVerdict(metrics: readonly MetricDelta[]): Verdict {
  const deciding = metrics.filter((metric) => DECIDING_METRICS.has(metric.id));
  const better = deciding.filter((metric) => metric.verdict === 'better').length;
  const worse = deciding.filter((metric) => metric.verdict === 'worse').length;

  if (better > 0 && worse === 0) return 'better';
  if (worse > 0 && better === 0) return 'worse';
  return 'same';
}

/**
 * Итог одной фразой, составленный из того, что вердикт и решило.
 *
 * Фиксированный набор чисел приводил к самоопровержению: вердикт «стало лучше»
 * шёл рядом с выросшим p99, который на решение не повлиял, потому что остался
 * в пределах разброса.
 */
function describe(verdict: Verdict, metrics: readonly MetricDelta[]): string {
  const deciding = metrics.filter((metric) => DECIDING_METRICS.has(metric.id));
  const moved = deciding.filter((metric) => metric.verdict !== 'same');

  if (moved.length === 0) {
    const listed = deciding.map(quote).join(', ');
    return `Разницы нет: ${listed} — в пределах разброса.`;
  }

  const listed = moved.map(quote).join(', ');
  const unchanged = deciding
    .filter((metric) => metric.verdict === 'same')
    .map((metric) => metric.label.toLowerCase());
  const tail = unchanged.length === 0 ? '' : ` Без изменений: ${unchanged.join(', ')}.`;

  return `${verdict === 'better' ? 'Стало лучше' : 'Стало хуже'}: ${listed}.${tail}`;
}

function quote(metric: MetricDelta): string {
  const unit = metric.unit === '' ? '' : ` ${metric.unit}`;
  return (
    `${metric.label.toLowerCase()} ${metric.before.toFixed(1)} → ` +
    `${metric.after.toFixed(1)}${unit}`
  );
}

/**
 * Оговорки к сравнению.
 *
 * Их отсутствие важнее их наличия: молчаливое сравнение двух несопоставимых
 * записей выглядит убедительнее, чем оно есть, и человек примет решение по
 * цифрам, которые ничего не значат.
 */
function collectCaveats(before: SessionSummary, after: SessionSummary): string[] {
  const caveats: string[] = [];

  if (before.application !== after.application) {
    caveats.push(
      `Записи сделаны на разных приложениях: ${before.application} и ${after.application}.`,
    );
  }

  const longer = Math.max(before.durationSeconds, after.durationSeconds);
  const shorter = Math.min(before.durationSeconds, after.durationSeconds);
  if (longer > 0 && (longer - shorter) / longer > MAX_DURATION_MISMATCH) {
    caveats.push(
      `Записи разной длины: ${before.durationSeconds.toFixed(0)} и ` +
        `${after.durationSeconds.toFixed(0)} с — сравнение приблизительное.`,
    );
  }

  if (
    before.stutterCount < MIN_STUTTERS_FOR_RATE &&
    after.stutterCount < MIN_STUTTERS_FOR_RATE
  ) {
    caveats.push(
      'Статтеров слишком мало для выводов об их частоте — сравнивайте по p99.',
    );
  }

  if (before.bottleneck === 'unknown' || after.bottleneck === 'unknown') {
    caveats.push('В одной из записей нет разбивки кадра — узкое место не сравнить.');
  }

  caveats.push(
    `Сцены: «${describeScene(before.scene ?? UNKNOWN_SCENE)}» и ` +
      `«${describeScene(after.scene ?? UNKNOWN_SCENE)}».`,
  );

  return caveats;
}
