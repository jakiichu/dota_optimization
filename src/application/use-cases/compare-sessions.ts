import { analyzeCapture, summarize } from '../../domain/telemetry/capture-analysis.ts';
import { UNKNOWN_SCENE } from '../../domain/telemetry/capture-scene.ts';
import {
  compareSessions,
  type SessionComparison,
  type SessionSummary,
} from '../../domain/telemetry/session-comparison.ts';
import type { SessionRecord, SessionStore } from '../ports/session-store.port.ts';

/**
 * Сравнить две сохранённые записи.
 *
 * Сводки считаются заново, а не берутся из файла: записи могли быть сделаны
 * разными версиями метрик, и сравнивать числа от разных детекторов — значит
 * получить разницу там, где менялся только наш код.
 */
export class CompareSessions {
  readonly #store: SessionStore;

  constructor(store: SessionStore) {
    this.#store = store;
  }

  async execute(beforeId: string, afterId: string): Promise<SessionComparison> {
    const [before, after] = await Promise.all([
      this.#store.load(beforeId),
      this.#store.load(afterId),
    ]);
    return compareSessions(summaryOf(before), summaryOf(after));
  }
}

function summaryOf(record: SessionRecord): SessionSummary {
  const { statistics } = analyzeCapture(record.capture, record.sensors);
  return summarize(
    record.id,
    record.label,
    record.capturedAt,
    record.capture,
    statistics,
    record.scene ?? UNKNOWN_SCENE,
  );
}
