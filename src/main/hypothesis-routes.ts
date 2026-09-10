import { TrackHypotheses } from '../application/use-cases/track-hypotheses.ts';
import type { RecommendationKind } from '../domain/gameconfig/recommendations.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';

/**
 * Гипотезы: завести, проверить, забыть.
 *
 * Клиент называет запись и вид рекомендации, а не саму рекомендацию. Иначе
 * можно было бы прислать предсказание, которого инструмент не делал, и получить
 * на него «подтвердилась».
 */
export function createHypothesisRoutes(track: TrackHypotheses): readonly JsonRoute[] {
  return [
    {
      path: '/api/hypotheses',
      async handle() {
        return { hypotheses: await track.list() };
      },
    },
    {
      path: '/api/hypotheses/record',
      method: 'POST',
      async handle(_query, body) {
        const { sessionId, kind } = fields(body, ['sessionId', 'kind']);
        return track.record(sessionId, kind as RecommendationKind);
      },
    },
    {
      path: '/api/hypotheses/settle',
      method: 'POST',
      async handle(_query, body) {
        const { id, afterSessionId } = fields(body, ['id', 'afterSessionId']);
        return track.settle(id, afterSessionId);
      },
    },
    {
      path: '/api/hypotheses/forget',
      method: 'POST',
      async handle(_query, body) {
        const { id } = fields(body, ['id']);
        await track.forget(id);
        return { hypotheses: await track.list() };
      },
    },
  ];
}

/** Строковые поля тела запроса: пустое значение — та же ошибка, что и отсутствие. */
function fields<K extends string>(body: string, names: readonly K[]): Record<K, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Тело запроса — не JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Тело запроса должно быть объектом.');
  }

  const record = parsed as Record<string, unknown>;
  const found = {} as Record<K, string>;
  for (const name of names) {
    const value = record[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Нужно поле ${name}.`);
    }
    found[name] = value.trim();
  }
  return found;
}
