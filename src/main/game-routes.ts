import type { ControlGame } from '../application/use-cases/control-game.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';

export function createGameRoutes(
  game: ControlGame,
  captureStatus: JsonRoute,
): readonly JsonRoute[] {
  return [
    { path: '/api/game', handle: () => game.status() },
    ...(['open', 'close'] as const).map((action): JsonRoute => ({
      path: `/api/game/${action}`,
      method: 'POST',
      async handle() {
        const capture = (await captureStatus.handle(new URLSearchParams(), '')) as {
          phase: string;
        };
        if (!['idle', 'completed', 'failed'].includes(capture.phase))
          throw new Error('Сначала остановите запись и дождитесь сохранения.');
        await game.execute(action);
        return { accepted: true };
      },
    })),
  ];
}
