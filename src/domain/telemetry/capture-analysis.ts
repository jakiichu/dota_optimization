import { computeFrameStatistics, type FrameStatistics } from './frame-metrics.ts';
import { EMPTY_PASSPORT, type MachinePassport } from '../snapshot/machine-passport.ts';
import { UNKNOWN_SCENE, type CaptureScene } from './capture-scene.ts';
import type { FrameCapture } from './frame-sample.ts';
import { parseGameConfig, type GameConfig } from '../gameconfig/game-config.ts';
import { UNKNOWN_MACHINE, type MachineContext } from '../gameconfig/machine-context.ts';
import { recommend, type Recommendation } from '../gameconfig/recommendations.ts';
import {
  buildProcessTimeline,
  steadyLoad,
  type BackgroundProcess,
} from './background-load.ts';
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
 * 8 — запись помнит состояние машины, и сравнение показывает, что менялось.
 * 9 — сводка несёт улики: аудит сверяется с записью, не читая кадры.
 * 10 — видно, кто ещё занимал процессор: улика «кадр ждал» получила имя.
 * 11 — AMD отдаёт температуры и причины троттлинга; разбор берёт показания у
 *      вендорского источника, а не у счётчиков Windows, и это меняет улики.
 */
export const METRICS_VERSION = 11;

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
  /**
   * Кто занимал процессор всю запись.
   *
   * Не улика и в список причин рывков не входит: постоянная нагрузка одинакова
   * в плохих кадрах и в хороших, а значит ни одного из них не выделяет. Но на
   * вопрос «что вообще крутилось» отвечает она, и это разная работа.
   */
  readonly background: readonly BackgroundProcess[];
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
  const correlation = correlateStutters(
    capture.frames,
    statistics.stutters,
    sensors,
    capture.applicationName,
  );
  const network = analyzeNetworkQuality(sensors);
  const cpuLoad = analyzeCpuLoad(sensors, statistics.bottleneck);
  const processes = buildProcessTimeline(sensors, capture.applicationName);

  return {
    statistics,
    correlation,
    network,
    cpuLoad,
    recommendations: recommend({ statistics, correlation, network, cpuLoad, ...machine }),
    background: processes === null ? [] : steadyLoad(processes),
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
  /**
   * Разбор целиком, а не одна статистика.
   *
   * Сводке нужны и улики, и сеть: иначе каждое новое поле в ней тянуло бы за
   * собой новый параметр во все места, где сводка собирается.
   */
  analysis: CaptureAnalysis,
  scene: CaptureScene = UNKNOWN_SCENE,
  passport: MachinePassport = EMPTY_PASSPORT,
): SessionSummary {
  const { statistics } = analysis;
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
    causes: analysis.correlation.tally,
    networkSeverity: analysis.network.severity,
    scene,
    passport,
  };
}
