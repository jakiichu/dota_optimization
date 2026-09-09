import { StartReplayRun } from '../application/use-cases/start-replay-run.ts';
import { InvalidReplayRunError } from '../domain/gameconfig/replay-run.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';

/**
 * Эталонный прогон: показать, что можно запустить, и запустить.
 *
 * Запуск игры — POST, и не только по приличиям: GET ходит по ссылке из любого
 * места, а открывать человеку игру по чужой ссылке нельзя.
 */
export function createBenchmarkRoutes(run: StartReplayRun): readonly JsonRoute[] {
  return [
    {
      path: '/api/benchmark',
      handle: () => run.options(),
    },
    {
      path: '/api/benchmark/launch',
      method: 'POST',
      handle: async (_query, body) => run.execute(replayRunFrom(body)),
    },
  ];
}

function replayRunFrom(body: string): {
  replayFile: string;
  startTick: number | null;
  label: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidReplayRunError('Тело запроса — не JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidReplayRunError('Тело запроса должно быть объектом.');
  }

  const { replayFile, startTick, label } = parsed as {
    replayFile?: unknown;
    startTick?: unknown;
    label?: unknown;
  };

  if (typeof replayFile !== 'string') {
    throw new InvalidReplayRunError('Нужно имя файла повтора: replayFile.');
  }
  // Тик может отсутствовать — тогда повтор идёт с начала. А вот мусор вместо
  // числа пропускать нельзя: он молча превратился бы в «с начала».
  if (startTick !== null && startTick !== undefined && typeof startTick !== 'number') {
    throw new InvalidReplayRunError('Тик должен быть числом или отсутствовать.');
  }

  return {
    replayFile: replayFile.trim(),
    startTick: typeof startTick === 'number' ? startTick : null,
    label: typeof label === 'string' ? label : '',
  };
}
