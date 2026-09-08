import {
  compareSessions,
  type SessionComparison,
} from '../../domain/telemetry/session-comparison.ts';
import type { SessionStore } from '../ports/session-store.port.ts';

/**
 * Сравнить две сохранённые записи.
 *
 * Читаем только сводки: полные записи весят мегабайты, а для сравнения нужны
 * шесть чисел.
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
    return compareSessions(before.summary, after.summary);
  }
}
