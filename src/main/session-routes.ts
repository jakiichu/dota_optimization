import type { SessionStore } from '../application/ports/session-store.port.ts';
import { AnalyzeSession } from '../application/use-cases/analyze-session.ts';
import { CompareSessions } from '../application/use-cases/compare-sessions.ts';
import { toCaptureView } from '../adapters/http/capture.view.ts';
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

/**
 * Разбор сохранённой записи текущими метриками.
 *
 * Игру запускать не нужно: кадры уже есть, а метрики — чистые функции от них.
 * Так новый детектор доходит до вчерашних записей.
 */
export function createSessionAnalyzeRoute(store: SessionStore): JsonRoute {
  const analyze = new AnalyzeSession(store);

  return {
    path: '/api/sessions/analyze',
    async handle(query) {
      const id = query.get('id');
      if (id === null) {
        throw new Error('Нужен идентификатор записи: id.');
      }
      const analyzed = await analyze.execute(id);
      return {
        ...toCaptureView({
          capture: analyzed.capture,
          statistics: analyzed.statistics,
          correlation: analyzed.correlation,
          network: analyzed.network,
          sensorSampleCount: analyzed.sensorSampleCount,
        }),
        sessionId: analyzed.id,
      };
    },
  };
}
