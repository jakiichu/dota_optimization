import { computeFrameStatistics, type FrameStatistics } from './frame-metrics.ts';
import type { FrameCapture } from './frame-sample.ts';
import { analyzeNetworkQuality, type NetworkQuality } from './network-quality.ts';
import type { SensorSample } from './sensor-sample.ts';
import type { SessionSummary } from './session-comparison.ts';
import { correlateStutters, type CorrelationReport } from './stutter-correlation.ts';

/**
 * Разбор записи: всё, что выводится из кадров и показаний сенсоров.
 *
 * Единственная точка, где это происходит. Хранилище держит только сырые кадры,
 * а метрики считает при чтении — поэтому новый детектор применяется ко всему
 * архиву сам, без переписывания файлов. Так было с ритмом кадров: он появился
 * после записи, и единственным способом применить его к ней оказался
 * одноразовый скрипт. Больше так быть не должно.
 */

/**
 * Версия набора метрик.
 *
 * Увеличивается, когда меняются детекторы или пороги. По ней видно, что
 * сохранённая сводка посчитана старым кодом и её надо пересчитать.
 *
 * 1 — первый набор: перцентили, статтеры, узкое место.
 * 2 — добавлены инпут-лаг и ритм кадров.
 * 3 — ровность ритма попала в сводку и участвует в сравнении.
 * 4 — добавлено качество сети.
 */
export const METRICS_VERSION = 4;

export interface CaptureAnalysis {
  readonly statistics: FrameStatistics;
  readonly correlation: CorrelationReport;
  /**
   * Качество сети за то же время.
   *
   * Отдельно от статистики кадров намеренно: сеть не удлиняет кадр, но рывок
   * на экране даёт такой же. Смешав их, мы бы предложили чинить графику там,
   * где виноват канал.
   */
  readonly network: NetworkQuality;
}

export function analyzeCapture(
  capture: FrameCapture,
  sensors: readonly SensorSample[],
): CaptureAnalysis {
  const statistics = computeFrameStatistics(capture.frames);
  return {
    statistics,
    correlation: correlateStutters(capture.frames, statistics.stutters, sensors),
    network: analyzeNetworkQuality(sensors),
  };
}

/**
 * Сводка для списка и сравнения.
 *
 * Это выжимка из полного разбора: держать её отдельно нужно, чтобы список
 * записей не читал мегабайты кадров ради шести чисел.
 */
export function summarize(
  id: string,
  label: string,
  capturedAt: string,
  capture: FrameCapture,
  statistics: FrameStatistics,
): SessionSummary {
  return {
    id,
    label: label.trim() === '' ? capture.applicationName : label.trim(),
    application: capture.applicationName,
    capturedAt,
    durationSeconds: statistics.durationSeconds,
    frameCount: statistics.frameCount,
    averageFps: statistics.averageFps,
    frameTime: statistics.frameTime,
    inputLatency: statistics.inputLatency,
    stutterCount: statistics.stutters.length,
    stuttersPerMinute: statistics.stuttersPerMinute,
    pacingTimeShare: statistics.pacing.timeShareInLongFrames,
    bottleneck: statistics.bottleneck.kind,
  };
}
