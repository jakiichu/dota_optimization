import {
  computeFrameStatistics,
  type FrameStatistics,
} from '../../domain/telemetry/frame-metrics.ts';
import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import type { SensorSample } from '../../domain/telemetry/sensor-sample.ts';
import {
  correlateStutters,
  type CorrelationReport,
} from '../../domain/telemetry/stutter-correlation.ts';
import type { FrameCaptureRequest, FrameCaptureSource } from '../ports/frame-capture.port.ts';
import type { SensorStream } from '../ports/sensor-stream.port.ts';

export interface FrameSessionResult {
  readonly capture: FrameCapture;
  readonly statistics: FrameStatistics;
  readonly correlation: CorrelationReport;
  readonly sensorSampleCount: number;
}

/**
 * Записать сессию, попутно собрав показания сенсоров, и разобрать её.
 *
 * Сенсоры пишутся параллельно кадрам именно здесь: сопоставить статтер с
 * состоянием железа можно только по замерам, сделанным в тот же момент.
 * Постфактум эти данные взять уже неоткуда.
 *
 * Разбор отделён от сбора: статистика и корреляция — чистые функции, их можно
 * пересчитать по сохранённой записи, не трогая игру.
 */
export class CaptureFrameSession {
  readonly #frames: FrameCaptureSource;
  readonly #sensors: SensorStream | null;

  constructor(frames: FrameCaptureSource, sensors: SensorStream | null = null) {
    this.#frames = frames;
    this.#sensors = sensors;
  }

  async execute(request: FrameCaptureRequest): Promise<FrameSessionResult> {
    const sensorSamples: SensorSample[] = [];
    const unsubscribe = this.#sensors?.subscribe((sample) => sensorSamples.push(sample));

    let capture: FrameCapture;
    try {
      capture = await this.#frames.capture(request);
    } finally {
      // Отписываемся в любом случае: иначе упавшая запись оставила бы за собой
      // живой процесс сайдкара.
      unsubscribe?.();
    }

    const statistics = computeFrameStatistics(capture.frames);
    return {
      capture,
      statistics,
      correlation: correlateStutters(capture.frames, statistics.stutters, sensorSamples),
      sensorSampleCount: sensorSamples.length,
    };
  }
}
