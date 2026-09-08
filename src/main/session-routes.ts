import type { SessionStore } from '../application/ports/session-store.port.ts';
import { CompareSessions } from '../application/use-cases/compare-sessions.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';

/** Список сохранённых записей — только сводки, полные записи весят мегабайты. */
export function createSessionListRoute(store: SessionStore): JsonRoute {
  return {
    path: '/api/sessions',
    async handle() {
      return { sessions: await store.list() };
    },
  };
}

export function createSessionCompareRoute(store: SessionStore): JsonRoute {
  const comparison = new CompareSessions(store);

  return {
    path: '/api/sessions/compare',
    async handle(query) {
      const before = query.get('before');
      const after = query.get('after');
      if (before === null || after === null) {
        throw new Error('Нужны обе записи: before и after.');
      }
      return comparison.execute(before, after);
    },
  };
}
