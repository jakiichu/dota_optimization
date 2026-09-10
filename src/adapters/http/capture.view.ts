import type { Maybe } from '../../domain/snapshot/system-snapshot.ts';
import type {
  Bottleneck,
  FrameStatistics,
  Stutter,
} from '../../domain/telemetry/frame-metrics.ts';
import type { FrameCapture, FrameSample } from '../../domain/telemetry/frame-sample.ts';
import {
  framesInWindow,
  selectFramesForChart,
  type FrameWindow,
} from '../../domain/telemetry/frame-window.ts';
import type { Recommendation } from '../../domain/gameconfig/recommendations.ts';
import type { NetworkQuality } from '../../domain/telemetry/network-quality.ts';
import type { CorrelationReport } from '../../domain/telemetry/stutter-correlation.ts';

/** Сколько худших статтеров показываем списком; остальные видны на графике. */
const WORST_STUTTERS_SHOWN = 12;

export interface CaptureSeries {
  readonly time: readonly number[];
  readonly frameTimeMs: readonly number[];
  /** Те же кадры, но значения оставлены только у статтеров — для отметок. */
  readonly stutterMs: readonly (number | null)[];
  readonly cpuBusyMs: readonly (number | null)[] | null;
  readonly gpuBusyMs: readonly (number | null)[] | null;
  /**
   * Показаны не все кадры записи.
   *
   * Не усреднение: из каждого окна взяты настоящие самый короткий и самый
   * длинный кадры, плюс все статтеры. Ни одно значение записи не выходит за
   * нарисованную огибающую — но точек на экране меньше, чем кадров в файле, и
   * молчать об этом нельзя.
   */
  readonly decimated: boolean;
  /** Сколько кадров стоит за этими точками. */
  readonly sourceFrameCount: number;
}

export interface CaptureView {
  readonly application: string;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly averageFps: number;
  readonly frameTime: FrameStatistics['frameTime'];
  /** `null`, если за запись не было ввода: это не нулевая задержка. */
  readonly inputLatency: FrameStatistics['inputLatency'];
  readonly stutterCount: number;
  readonly stuttersPerMinute: number;
  readonly bottleneck: Bottleneck;
  readonly pacing: FrameStatistics['pacing'];
  readonly worstStutters: readonly Stutter[];
  readonly series: CaptureSeries;
  readonly availableColumns: readonly string[];
  readonly correlation: CorrelationReport;
  readonly network: NetworkQuality;
  readonly recommendations: readonly Recommendation[];
  readonly sensorSampleCount: number;
}

/**
 * Готовит запись к отрисовке.
 *
 * Кадры уходят на клиент целиком, без прореживания. Прореживание убирает
 * именно то, ради чего запись и делалась: одиночный кадр на 200 мс — это одна
 * точка из двенадцати тысяч, и первый же алгоритм усреднения её сотрёт.
 */
export interface CaptureViewInput {
  readonly capture: FrameCapture;
  readonly statistics: FrameStatistics;
  readonly correlation: CorrelationReport;
  readonly network: NetworkQuality;
  readonly recommendations: readonly Recommendation[];
  readonly sensorSampleCount: number;
  /**
   * Какой кусок записи показать на графике.
   *
   * Метрики от этого не меняются: они всегда считаются по всей записи. Окно —
   * это увеличение, а не выборка, и подменять им статистику нельзя.
   */
  readonly window?: FrameWindow;
}

export function toCaptureView(input: CaptureViewInput): CaptureView {
  const { capture, statistics } = input;
  return {
    application: capture.applicationName,
    frameCount: statistics.frameCount,
    durationSeconds: statistics.durationSeconds,
    averageFps: statistics.averageFps,
    frameTime: statistics.frameTime,
    inputLatency: statistics.inputLatency,
    stutterCount: statistics.stutters.length,
    stuttersPerMinute: statistics.stuttersPerMinute,
    bottleneck: statistics.bottleneck,
    pacing: statistics.pacing,
    worstStutters: worstStutters(statistics.stutters),
    series: toSeries(capture.frames, statistics.stutters, input.window),
    availableColumns: capture.availableColumns,
    correlation: input.correlation,
    network: input.network,
    recommendations: input.recommendations,
    sensorSampleCount: input.sensorSampleCount,
  };
}

function worstStutters(stutters: readonly Stutter[]): Stutter[] {
  return [...stutters]
    .sort((left, right) => right.frameTimeMs - left.frameTimeMs)
    .slice(0, WORST_STUTTERS_SHOWN);
}

function toSeries(
  allFrames: readonly FrameSample[],
  stutters: readonly Stutter[],
  window: FrameWindow | undefined,
): CaptureSeries {
  // Сначала окно, потом выбор точек: приблизив кусок часовой записи, человек
  // должен увидеть его кадр за кадром, а не ту же огибающую крупнее.
  const bounds =
    window === undefined
      ? { from: 0, to: allFrames.length }
      : framesInWindow(allFrames, window);
  const frames = allFrames.slice(bounds.from, bounds.to);

  const inWindow = stutters.filter(
    (stutter) => stutter.frameIndex >= bounds.from && stutter.frameIndex < bounds.to,
  );
  const shifted = inWindow.map((stutter) => ({
    ...stutter,
    frameIndex: stutter.frameIndex - bounds.from,
  }));
  const selection = selectFramesForChart(frames, shifted);
  const stutterSeconds = new Set(inWindow.map((stutter) => stutter.atSeconds));

  const time: number[] = [];
  const frameTimeMs: number[] = [];
  const stutterMs: (number | null)[] = [];
  const cpuBusyMs: (number | null)[] = [];
  const gpuBusyMs: (number | null)[] = [];

  for (const index of selection.indices) {
    const frame = frames[index];
    if (frame === undefined) continue;

    time.push(frame.startSeconds);
    frameTimeMs.push(frame.frameTimeMs);
    // Разрывы между отметками uPlot просто не рисует — получается россыпь точек.
    stutterMs.push(stutterSeconds.has(frame.startSeconds) ? frame.frameTimeMs : null);
    cpuBusyMs.push(frame.cpuBusyMs);
    gpuBusyMs.push(frame.gpuBusyMs);
  }

  return {
    time,
    frameTimeMs,
    stutterMs,
    // Целиком пустую линию не отдаём вовсе: пусть интерфейс покажет, что этой
    // метрики нет, вместо того чтобы рисовать ноль.
    cpuBusyMs: hasAnyValue(cpuBusyMs) ? cpuBusyMs : null,
    gpuBusyMs: hasAnyValue(gpuBusyMs) ? gpuBusyMs : null,
    decimated: selection.decimated,
    sourceFrameCount: selection.sourceFrameCount,
  };
}

function hasAnyValue(values: readonly Maybe<number>[]): boolean {
  return values.some((value) => value !== null);
}
