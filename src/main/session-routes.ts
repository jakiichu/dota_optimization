import type { SessionStore } from '../application/ports/session-store.port.ts';
import { AnalyzeSession } from '../application/use-cases/analyze-session.ts';
import type { MachineContextSource } from './game-config-source.ts';
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
export function createSessionAnalyzeRoute(
  store: SessionStore,
  machine: MachineContextSource,
): JsonRoute {
  const analyze = new AnalyzeSession(store, () => machine.get());

  /**
   * Последняя разобранная запись остаётся в памяти.
   *
   * Ради увеличения: приблизив кусок часовой записи, человек ждёт следующего
   * окна, а не повторного чтения девяноста мегабайт с диска. Помним ровно одну
   * — держать в памяти весь архив незачем.
   */
  let last: { id: string; analyzed: Awaited<ReturnType<typeof analyze.execute>> } | null =
    null;

  return {
    path: '/api/sessions/analyze',
    async handle(query) {
      const id = query.get('id');
      if (id === null) {
        throw new Error('Нужен идентификатор записи: id.');
      }

      if (last?.id !== id) {
        last = { id, analyzed: await analyze.execute(id) };
      }
      const analyzed = last.analyzed;

      return {
        ...toCaptureView({
          capture: analyzed.capture,
          statistics: analyzed.statistics,
          correlation: analyzed.correlation,
          network: analyzed.network,
          cpuLoad: analyzed.cpuLoad,
          recommendations: analyzed.recommendations,
          sensorSampleCount: analyzed.sensorSampleCount,
          background: analyzed.background,
          ...windowFrom(query),
        }),
        sessionId: analyzed.id,
      };
    },
  };
}

/**
 * Окно времени для графика.
 *
 * Метрики от него не зависят: они всегда считаются по всей записи. Окно — это
 * увеличение, а не выборка, и подменять им статистику нельзя.
 */
function windowFrom(query: URLSearchParams): { window?: { fromSeconds: number; toSeconds: number } } {
  const from = Number.parseFloat(query.get('from') ?? '');
  const to = Number.parseFloat(query.get('to') ?? '');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return {};

  return { window: { fromSeconds: from, toSeconds: to } };
}
