import { computeFrameStatistics, type FrameStatistics } from './frame-metrics.ts';
import { UNKNOWN_SCENE, type CaptureScene } from './capture-scene.ts';
import type { FrameCapture } from './frame-sample.ts';
import { parseGameConfig, type GameConfig } from '../gameconfig/game-config.ts';
import { UNKNOWN_MACHINE, type MachineContext } from '../gameconfig/machine-context.ts';
import { recommend, type Recommendation } from '../gameconfig/recommendations.ts';
import { analyzeCpuLoad, type CpuLoadProfile } from './cpu-load.ts';
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
 * 5 — записи помечаются сценой; без неё сравнение считается невозможным.
 * 6 — по записи считаются рекомендации.
 * 7 — разбирается нагрузка на процессор: занятые потоки и сброс частот.
 */
export const METRICS_VERSION = 7;

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
  /**
   * Что происходило с процессором.
   *
   * «Упор в процессор» — вердикт верный, но бесполезный: непонятно, что делать.
   * Здесь он разложен на «упёрлись в одно ядро» и «процессор сбрасывал
   * частоты», и действия по ним разные.
   */
  readonly cpuLoad: CpuLoadProfile;
  /**
   * Что попробовать поменять — исходя из этой записи.
   *
   * Считается здесь же, а не отдельным экраном: рекомендация без записи, из
   * которой она выведена, — обычный совет из интернета.
   */
  readonly recommendations: readonly Recommendation[];
}

export function analyzeCapture(
  capture: FrameCapture,
  sensors: readonly SensorSample[],
  /**
   * Что известно о машине: конфиг игры и частота монитора.
   *
   * Без конфига рекомендации повторяли бы уже сделанное, а без частоты
   * считали бы потолок кадров от текущего ритма игры — то есть от того самого
   * числа, которое и промахивается мимо развёртки.
   */
  machine: MachineContext = UNKNOWN_MACHINE,
): CaptureAnalysis {
  const statistics = computeFrameStatistics(capture.frames);
  const correlation = correlateStutters(capture.frames, statistics.stutters, sensors);
  const network = analyzeNetworkQuality(sensors);
  const cpuLoad = analyzeCpuLoad(sensors, statistics.bottleneck);

  return {
    statistics,
    correlation,
    network,
    cpuLoad,
    recommendations: recommend({ statistics, correlation, network, cpuLoad, ...machine }),
  };
}

/** Разбирает конфиг, если он есть; иначе рекомендации обходятся без него. */
export function configFrom(path: string | null, text: string | null): GameConfig | null {
  return path === null || text === null ? null : parseGameConfig(path, text);
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
  scene: CaptureScene = UNKNOWN_SCENE,
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
    scene,
  };
}
