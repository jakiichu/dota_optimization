import type { Maybe } from '../snapshot/system-snapshot.ts';
import type { FrameSample } from './frame-sample.ts';

/**
 * Окно, по которому считается локальная норма кадра.
 *
 * Нечётное и небольшое: статтер надо сравнивать с соседями, а не со средним по
 * всей записи. Иначе переход из меню в бой сам по себе выглядит как сотня
 * статтеров, а настоящие фризы посреди боя теряются.
 */
const BASELINE_WINDOW = 19;

/** Кадр считается статтером, если он вдвое длиннее локальной нормы… */
const STUTTER_RATIO = 2;

/** …и при этом отстаёт от неё хотя бы на столько. */
const STUTTER_MIN_DELTA_MS = 4;

/** Доля времени кадра, начиная с которой считаем устройство загруженным. */
const SATURATED_SHARE = 0.95;

/** Ниже этой доли устройство точно не является ограничителем. */
const RELAXED_SHARE = 0.9;

/** Насколько ровными должны быть кадры, чтобы заподозрить лимитер или VSync. */
const LIMITED_P99_TO_P50 = 1.1;

const SECONDS_IN_MINUTE = 60;
const MS_IN_SECOND = 1000;

export interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly p999: number;
}

export interface Stutter {
  /** Позиция кадра в записи: по ней корреляция достаёт сам кадр. */
  readonly frameIndex: number;
  readonly atSeconds: number;
  readonly frameTimeMs: number;
  /** Локальная норма, относительно которой кадр признан выбросом. */
  readonly baselineMs: number;
  readonly ratio: number;
}

export type BottleneckKind = 'gpu' | 'cpu' | 'mixed' | 'limited' | 'unknown';

export interface Bottleneck {
  readonly kind: BottleneckKind;
  readonly gpuBusyShare: Maybe<number>;
  readonly cpuBusyShare: Maybe<number>;
  readonly explanation: string;
}

export interface FrameStatistics {
  readonly frameCount: number;
  /**
   * Задержка от ввода до кадра на экране.
   *
   * `null`, если за запись не было ни одного ввода: PresentMon меряет её только
   * по кадрам, на которые пришлось нажатие. Отсутствие ввода — не нулевая
   * задержка, и подменять одно другим нельзя.
   */
  readonly inputLatency: Percentiles | null;
  readonly durationSeconds: number;
  readonly averageFps: number;
  readonly frameTime: Percentiles;
  readonly stutters: readonly Stutter[];
  readonly stuttersPerMinute: number;
  readonly bottleneck: Bottleneck;
}

const EMPTY_PERCENTILES: Percentiles = { p50: 0, p95: 0, p99: 0, p999: 0 };

const NO_DATA: FrameStatistics = {
  frameCount: 0,
  durationSeconds: 0,
  averageFps: 0,
  frameTime: EMPTY_PERCENTILES,
  inputLatency: null,
  stutters: [],
  stuttersPerMinute: 0,
  bottleneck: {
    kind: 'unknown',
    gpuBusyShare: null,
    cpuBusyShare: null,
    explanation: 'Кадры не записаны.',
  },
};

export function computeFrameStatistics(frames: readonly FrameSample[]): FrameStatistics {
  if (frames.length === 0) {
    return NO_DATA;
  }

  const frameTimes = frames.map((frame) => frame.frameTimeMs);
  const durationSeconds = frameTimes.reduce((sum, ms) => sum + ms, 0) / MS_IN_SECOND;
  const percentiles = computePercentiles(frameTimes);
  const stutters = findStutters(frames);

  return {
    frameCount: frames.length,
    inputLatency: computeInputLatency(frames),
    durationSeconds,
    averageFps: durationSeconds === 0 ? 0 : frames.length / durationSeconds,
    frameTime: percentiles,
    stutters,
    stuttersPerMinute:
      durationSeconds === 0
        ? 0
        : (stutters.length * SECONDS_IN_MINUTE) / durationSeconds,
    bottleneck: classifyBottleneck(frames, percentiles),
  };
}

// --- перцентили ------------------------------------------------------------

/**
 * Метод ближайшего ранга: никакой интерполяции.
 *
 * p99 должен быть настоящим значением одного из кадров — иначе на вопрос
 * «какой именно кадр был плохим» ответить нечем.
 */
export function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil(fraction * sortedAscending.length);
  const index = Math.min(Math.max(rank - 1, 0), sortedAscending.length - 1);
  return sortedAscending[index] ?? 0;
}

function computeInputLatency(frames: readonly FrameSample[]): Percentiles | null {
  const measured = frames
    .map((frame) => frame.clickToPhotonMs ?? frame.allInputToPhotonMs)
    .filter((value): value is number => value !== null);
  return measured.length === 0 ? null : computePercentiles(measured);
}

function computePercentiles(frameTimes: readonly number[]): Percentiles {
  const sorted = [...frameTimes].sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    p999: percentile(sorted, 0.999),
  };
}

// --- статтеры --------------------------------------------------------------

/**
 * Ищет кадры, выпадающие из локальной нормы.
 *
 * Порог двойной: и отношение, и абсолютная разница. Без второго условия скачок
 * с 2 до 5 мс при 500 FPS считался бы статтером, хотя человек его не заметит.
 */
export function findStutters(frames: readonly FrameSample[]): Stutter[] {
  const frameTimes = frames.map((frame) => frame.frameTimeMs);
  const stutters: Stutter[] = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) continue;

    const baseline = localMedian(frameTimes, index);
    if (baseline === 0) continue;

    const delta = frame.frameTimeMs - baseline;
    if (frame.frameTimeMs < baseline * STUTTER_RATIO) continue;
    if (delta < STUTTER_MIN_DELTA_MS) continue;

    stutters.push({
      frameIndex: index,
      atSeconds: frame.startSeconds,
      frameTimeMs: frame.frameTimeMs,
      baselineMs: baseline,
      ratio: frame.frameTimeMs / baseline,
    });
  }

  return stutters;
}

/**
 * Медиана окна вокруг кадра, из которой исключён он сам.
 *
 * Если оставить кадр в окне, длинный фриз поднимет собственную норму и
 * перестанет считаться выбросом — тем сильнее, чем он серьёзнее.
 */
function localMedian(frameTimes: readonly number[], index: number): number {
  const half = Math.floor(BASELINE_WINDOW / 2);
  const from = Math.max(0, index - half);
  const to = Math.min(frameTimes.length, index + half + 1);

  const window: number[] = [];
  for (let position = from; position < to; position += 1) {
    if (position === index) continue;
    const value = frameTimes[position];
    if (value !== undefined) window.push(value);
  }
  if (window.length === 0) return 0;

  window.sort((left, right) => left - right);
  const middle = Math.floor(window.length / 2);
  if (window.length % 2 === 1) return window[middle] ?? 0;
  return ((window[middle - 1] ?? 0) + (window[middle] ?? 0)) / 2;
}

// --- во что упёрлись -------------------------------------------------------

/** Поля названы как в Bottleneck, чтобы их можно было расширить в него как есть. */
interface Shares {
  readonly gpuBusyShare: Maybe<number>;
  readonly cpuBusyShare: Maybe<number>;
}

/**
 * Определяет ограничитель по доле времени кадра, занятой каждым устройством.
 *
 * Именно доля, а не «утилизация» из счётчиков: 99% загрузки GPU в диспетчере
 * задач ничего не говорят о том, ждал ли его CPU.
 */
export function classifyBottleneck(
  frames: readonly FrameSample[],
  percentiles: Percentiles,
): Bottleneck {
  const shares = computeShares(frames);

  if (shares.gpuBusyShare === null && shares.cpuBusyShare === null) {
    return {
      kind: 'unknown',
      gpuBusyShare: null,
      cpuBusyShare: null,
      explanation:
        'В записи нет разбивки кадра по CPU и GPU — нужны метрики PresentMon 2.x.',
    };
  }

  const gpu = shares.gpuBusyShare ?? 0;
  const cpu = shares.cpuBusyShare ?? 0;

  if (gpu >= SATURATED_SHARE) {
    return {
      kind: 'gpu',
      ...shares,
      explanation: `GPU занят ${asPercent(gpu)} времени кадра — упор в видеокарту.`,
    };
  }

  if (cpu >= SATURATED_SHARE) {
    return {
      kind: 'cpu',
      ...shares,
      explanation: `CPU занят ${asPercent(cpu)} времени кадра, GPU ждёт — упор в процессор.`,
    };
  }

  // Ровные кадры при незагруженном железе — это ограничитель, а не узкое место.
  const flat =
    percentiles.p50 > 0 && percentiles.p99 / percentiles.p50 < LIMITED_P99_TO_P50;
  if (flat && gpu < RELAXED_SHARE && cpu < RELAXED_SHARE) {
    return {
      kind: 'limited',
      ...shares,
      explanation:
        'Кадры очень ровные, а железо не загружено: работает ограничитель кадров или VSync.',
    };
  }

  return {
    kind: 'mixed',
    ...shares,
    explanation:
      `Ни CPU (${asPercent(cpu)}), ни GPU (${asPercent(gpu)}) не заняты кадр целиком: ` +
      'ограничитель меняется по ходу записи.',
  };
}

function computeShares(frames: readonly FrameSample[]): Shares {
  let totalFrameTime = 0;
  let totalGpu = 0;
  let totalCpu = 0;
  let gpuSamples = 0;
  let cpuSamples = 0;

  for (const frame of frames) {
    totalFrameTime += frame.frameTimeMs;
    if (frame.gpuBusyMs !== null) {
      totalGpu += frame.gpuBusyMs;
      gpuSamples += 1;
    }
    if (frame.cpuBusyMs !== null) {
      totalCpu += frame.cpuBusyMs;
      cpuSamples += 1;
    }
  }

  if (totalFrameTime === 0) return { gpuBusyShare: null, cpuBusyShare: null };

  return {
    gpuBusyShare: gpuSamples === 0 ? null : totalGpu / totalFrameTime,
    cpuBusyShare: cpuSamples === 0 ? null : totalCpu / totalFrameTime,
  };
}

function asPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
