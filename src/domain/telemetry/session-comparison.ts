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
  readonly bottleneck: BottleneckKind;
}

export type Verdict = 'better' | 'worse' | 'same';

export interface MetricDelta {
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
  readonly metrics: readonly MetricDelta[];
  readonly bottleneckChanged: boolean;
  readonly verdict: Verdict;
  /** Итог одной фразой. */
  readonly summary: string;
  /** Чем сравнение ограничено. Пусто — значит, оговорок нет. */
  readonly caveats: readonly string[];
}

interface MetricSpec {
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
    label: 'Средний FPS',
    unit: '',
    lowerIsBetter: false,
    noise: NOISE_FPS,
    of: (session) => session.averageFps,
  },
  {
    label: 'Медиана кадра',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.frameTime.p50,
  },
  {
    label: 'p99 кадра',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.frameTime.p99,
  },
  {
    label: 'p99.9 кадра',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.frameTime.p999,
  },
  {
    label: 'Статтеров в минуту',
    unit: '',
    lowerIsBetter: true,
    noise: NOISE_STUTTERS_PER_MINUTE,
    of: (session) => session.stuttersPerMinute,
  },
  {
    label: 'Инпут-лаг p99',
    unit: 'мс',
    lowerIsBetter: true,
    noise: NOISE_MS,
    of: (session) => session.inputLatency?.p99 ?? null,
  },
];

/** Метрики, по которым выносится общий вердикт: их человек и ощущает. */
const DECIDING_METRICS = new Set(['p99 кадра', 'Статтеров в минуту']);

export function compareSessions(
  before: SessionSummary,
  after: SessionSummary,
): SessionComparison {
  const metrics = METRICS.map((spec) => compareMetric(spec, before, after)).filter(
    (metric): metric is MetricDelta => metric !== null,
  );

  const verdict = overallVerdict(metrics);

  return {
    before,
    after,
    metrics,
    bottleneckChanged: before.bottleneck !== after.bottleneck,
    verdict,
    summary: describe(verdict, before, after),
    caveats: collectCaveats(before, after),
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
  const deciding = metrics.filter((metric) => DECIDING_METRICS.has(metric.label));
  const better = deciding.filter((metric) => metric.verdict === 'better').length;
  const worse = deciding.filter((metric) => metric.verdict === 'worse').length;

  if (better > 0 && worse === 0) return 'better';
  if (worse > 0 && better === 0) return 'worse';
  return 'same';
}

function describe(verdict: Verdict, before: SessionSummary, after: SessionSummary): string {
  const p99 = `p99 ${before.frameTime.p99.toFixed(1)} → ${after.frameTime.p99.toFixed(1)} мс`;
  const stutters =
    `статтеров ${before.stuttersPerMinute.toFixed(1)} → ` +
    `${after.stuttersPerMinute.toFixed(1)} в минуту`;

  if (verdict === 'better') return `Стало лучше: ${p99}, ${stutters}.`;
  if (verdict === 'worse') return `Стало хуже: ${p99}, ${stutters}.`;
  return `Разницы нет: ${p99}, ${stutters} — в пределах разброса.`;
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
    'Сравнение честно только если сцена была одинаковой: бой и меню дают разные ' +
      'числа при любых настройках.',
  );

  return caveats;
}
