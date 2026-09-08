import {
  analyzeCapture,
  type CaptureAnalysis,
} from '../../domain/telemetry/capture-analysis.ts';
import {
  UNKNOWN_MACHINE,
  type MachineContext,
} from '../../domain/gameconfig/machine-context.ts';
import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import type { SessionStore } from '../ports/session-store.port.ts';

export interface AnalyzedSession extends CaptureAnalysis {
  readonly id: string;
  readonly label: string;
  readonly capture: FrameCapture;
  readonly sensorSampleCount: number;
}

/**
 * Разобрать сохранённую запись текущими метриками.
 *
 * Игру для этого запускать не нужно: кадры уже записаны, а метрики — чистые
 * функции от них. Именно этого не хватило, когда появился детектор ритма:
 * применить его к вчерашней записи было нечем.
 */
export class AnalyzeSession {
  readonly #store: SessionStore;
  readonly #machine: () => Promise<MachineContext>;

  constructor(
    store: SessionStore,
    machine: () => Promise<MachineContext> = async () => UNKNOWN_MACHINE,
  ) {
    this.#store = store;
    this.#machine = machine;
  }

  async execute(id: string): Promise<AnalyzedSession> {
    const record = await this.#store.load(id);
    return {
      id: record.id,
      label: record.label,
      capture: record.capture,
      sensorSampleCount: record.sensors.length,
      ...analyzeCapture(record.capture, record.sensors, await this.#machine()),
    };
  }
}
