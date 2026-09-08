import { computeFrameStatistics, type FrameStatistics } from '../../domain/telemetry/frame-metrics.ts';
import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import type { FrameCaptureSource, FrameCaptureRequest } from '../ports/frame-capture.port.ts';

export interface FrameSessionResult {
  readonly capture: FrameCapture;
  readonly statistics: FrameStatistics;
}

/**
 * Записать сессию и посчитать по ней метрики.
 *
 * Запись и разбор разделены намеренно: статистика считается чистой функцией от
 * кадров, поэтому её можно пересчитать по сохранённой записи, не трогая игру.
 */
export class CaptureFrameSession {
  readonly #source: FrameCaptureSource;

  constructor(source: FrameCaptureSource) {
    this.#source = source;
  }

  async execute(request: FrameCaptureRequest): Promise<FrameSessionResult> {
    const capture = await this.#source.capture(request);
    return { capture, statistics: computeFrameStatistics(capture.frames) };
  }
}
