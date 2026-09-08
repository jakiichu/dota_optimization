import type { SensorSample } from './sensor-sample.ts';

/**
 * Качество сети за время записи.
 *
 * Нужно не ради самих миллисекунд, а чтобы **отличить сетевой рывок от
 * кадрового**. На экране они выглядят одинаково, а лечатся противоположно:
 * человек месяцами крутит настройки графики, когда проблема в канале.
 *
 * Прямой причиной длинного кадра сеть обычно не является — кадр рисуется
 * независимо от того, дошёл ли пакет. Поэтому вывод здесь отдельный от
 * статтеров, а не подмешивается к ним.
 */

/** Дрожание задержки, за которым игра начинает «телепортировать». */
const NOTICEABLE_JITTER_MS = 10;
const BAD_JITTER_MS = 30;

/** Потери, за которыми играть уже тяжело. */
const NOTICEABLE_LOSS = 0.01;
const BAD_LOSS = 0.05;

/** Меньше этого числа замеров — судить не о чем. */
const MIN_SAMPLES = 5;

export type NetworkSeverity = 'ok' | 'noticeable' | 'bad';

export interface NetworkTargetQuality {
  readonly label: string;
  readonly target: string;
  readonly sampleCount: number;
  readonly medianMs: number | null;
  readonly worstMs: number | null;
  /** Среднее изменение задержки от замера к замеру — это и есть дрожание. */
  readonly jitterMs: number | null;
  readonly lossShare: number;
  readonly severity: NetworkSeverity;
}

export interface NetworkQuality {
  /** Измерялась ли сеть вообще. */
  readonly measured: boolean;
  readonly targets: readonly NetworkTargetQuality[];
  readonly severity: NetworkSeverity;
  readonly summary: string;
}

const NOT_MEASURED: NetworkQuality = {
  measured: false,
  targets: [],
  severity: 'ok',
  summary: 'Сеть не измерялась.',
};

export function analyzeNetworkQuality(
  samples: readonly SensorSample[],
): NetworkQuality {
  const byTarget = groupByTarget(samples);
  if (byTarget.size === 0) return NOT_MEASURED;

  const targets = [...byTarget.values()]
    .map(describeTarget)
    .filter((target): target is NetworkTargetQuality => target !== null);

  if (targets.length === 0) return NOT_MEASURED;

  const severity = worstSeverity(targets);
  return {
    measured: true,
    targets,
    severity,
    summary: describe(severity, targets),
  };
}

interface TargetSamples {
  readonly label: string;
  readonly target: string;
  readonly roundTrips: number[];
  failures: number;
  total: number;
}

function groupByTarget(samples: readonly SensorSample[]): Map<string, TargetSamples> {
  const byTarget = new Map<string, TargetSamples>();

  for (const sample of samples) {
    for (const probe of sample.network) {
      let entry = byTarget.get(probe.target);
      if (entry === undefined) {
        entry = {
          label: probe.label,
          target: probe.target,
          roundTrips: [],
          failures: 0,
          total: 0,
        };
        byTarget.set(probe.target, entry);
      }

      entry.total += 1;
      if (probe.success && probe.roundTripMs !== null) {
        entry.roundTrips.push(probe.roundTripMs);
      } else {
        entry.failures += 1;
      }
    }
  }

  return byTarget;
}

function describeTarget(entry: TargetSamples): NetworkTargetQuality | null {
  if (entry.total < MIN_SAMPLES) return null;

  const lossShare = entry.failures / entry.total;
  const median = medianOf(entry.roundTrips);
  const jitter = meanStepChange(entry.roundTrips);

  return {
    label: entry.label,
    target: entry.target,
    sampleCount: entry.total,
    medianMs: median,
    worstMs: entry.roundTrips.length === 0 ? null : Math.max(...entry.roundTrips),
    jitterMs: jitter,
    lossShare,
    severity: judge(jitter, lossShare),
  };
}

function judge(jitterMs: number | null, lossShare: number): NetworkSeverity {
  if (lossShare >= BAD_LOSS) return 'bad';
  if (jitterMs !== null && jitterMs >= BAD_JITTER_MS) return 'bad';
  if (lossShare >= NOTICEABLE_LOSS) return 'noticeable';
  if (jitterMs !== null && jitterMs >= NOTICEABLE_JITTER_MS) return 'noticeable';
  return 'ok';
}

function worstSeverity(targets: readonly NetworkTargetQuality[]): NetworkSeverity {
  if (targets.some((target) => target.severity === 'bad')) return 'bad';
  if (targets.some((target) => target.severity === 'noticeable')) return 'noticeable';
  return 'ok';
}

function describe(
  severity: NetworkSeverity,
  targets: readonly NetworkTargetQuality[],
): string {
  if (severity === 'ok') {
    return 'Сеть вела себя ровно — рывки, если они были, не сетевые.';
  }

  const worst = [...targets].sort(
    (left, right) => rank(right.severity) - rank(left.severity),
  )[0];
  if (worst === undefined) return 'Сеть вела себя ровно.';

  const parts: string[] = [];
  if (worst.jitterMs !== null && worst.jitterMs >= NOTICEABLE_JITTER_MS) {
    parts.push(`дрожание задержки ${worst.jitterMs.toFixed(0)} мс`);
  }
  if (worst.lossShare >= NOTICEABLE_LOSS) {
    parts.push(`потери ${(worst.lossShare * 100).toFixed(1)}%`);
  }

  return (
    `${worst.label}: ${parts.join(', ')}. ` +
    'На экране это выглядит как рывки, но кадры тут ни при чём — ' +
    'настройки графики такое не лечат.'
  );
}

function rank(severity: NetworkSeverity): number {
  if (severity === 'bad') return 2;
  if (severity === 'noticeable') return 1;
  return 0;
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Дрожание: насколько задержка меняется от замера к замеру. */
function meanStepChange(values: readonly number[]): number | null {
  if (values.length < 2) return null;

  let total = 0;
  for (let index = 1; index < values.length; index += 1) {
    total += Math.abs((values[index] ?? 0) - (values[index - 1] ?? 0));
  }
  return total / (values.length - 1);
}
