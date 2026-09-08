import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import type { SensorSample } from '../../domain/telemetry/sensor-sample.ts';
import type { SessionSummary } from '../../domain/telemetry/session-comparison.ts';

/**
 * Сохранённая запись — только сырое.
 *
 * Метрики здесь не лежат намеренно: они выводятся из кадров при чтении.
 * Сохранив посчитанные значения, мы бы законсервировали их вместе с версией
 * кода, и новый детектор пришлось бы применять вручную к каждому файлу.
 */
export interface SessionRecord {
  readonly id: string;
  readonly label: string;
  readonly capturedAt: string;
  /** Версия метрик, которой посчитана сохранённая сводка. */
  readonly metricsVersion: number;
  readonly capture: FrameCapture;
  readonly sensors: readonly SensorSample[];
}

export interface SessionStore {
  save(
    label: string,
    capture: FrameCapture,
    sensors: readonly SensorSample[],
  ): Promise<SessionSummary>;

  /**
   * Сводки, свежие первыми.
   *
   * Устаревшие пересчитываются на месте: список — то место, где человек и
   * увидит старую запись, и показывать ему числа от прошлой версии нельзя.
   */
  list(): Promise<readonly SessionSummary[]>;

  load(id: string): Promise<SessionRecord>;
}
