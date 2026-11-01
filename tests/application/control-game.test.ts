import { describe, expect, it, vi } from 'vitest';
import { ControlGame } from '../../src/application/use-cases/control-game.ts';
import { createGameRoutes } from '../../src/main/game-routes.ts';

function setup() {
  let running = false;
  let now = 0;
  const port = {
    isRunning: vi.fn(async () => running),
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const game = new ControlGame(port, () => now);
  return {
    game,
    port,
    setRunning: (value: boolean) => {
      running = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('управление Dota', () => {
  it('подтверждает запуск только после появления процесса', async () => {
    const { game, port, setRunning } = setup();
    await game.execute('open');
    expect(await game.status()).toMatchObject({ phase: 'starting' });
    await expect(game.execute('open')).rejects.toThrow('предыдущей команды');
    expect(port.open).toHaveBeenCalledTimes(1);
    setRunning(true);
    expect(await game.status()).toMatchObject({ phase: 'running' });
    await game.execute('open');
    expect(port.open).toHaveBeenCalledTimes(1);
  });

  it('подтверждает закрытие только после исчезновения процесса', async () => {
    const { game, setRunning, port } = setup();
    setRunning(true);
    await game.execute('close');
    expect(await game.status()).toMatchObject({ phase: 'closing' });
    setRunning(false);
    expect(await game.status()).toMatchObject({ phase: 'stopped' });
    expect(port.close).toHaveBeenCalledOnce();
  });

  it.each(['open', 'close'] as const)(
    'показывает таймаут %s и позволяет повторить команду',
    async (action) => {
      const { game, setRunning, advance, port } = setup();
      setRunning(action === 'close');
      await game.execute(action);
      advance(180_001);
      expect((await game.status()).error).toBeTruthy();
      expect((await game.status()).error).toBeTruthy();
      await game.execute(action);
      expect(port[action]).toHaveBeenCalledTimes(2);
      expect((await game.status()).error).toBeNull();
    },
  );

  it('ошибку проверки процесса не принимает за закрытую игру', async () => {
    const { game, port } = setup();
    port.isRunning.mockRejectedValueOnce(new Error('tasklist unavailable'));
    await expect(game.execute('open')).rejects.toThrow('tasklist unavailable');
    expect(port.open).not.toHaveBeenCalled();
    await game.execute('open');
    expect(port.open).toHaveBeenCalledOnce();
  });

  it('не снимает блокировку, пока команда запуска ещё выполняется', async () => {
    const { game, port, advance } = setup();
    let finish!: () => void;
    port.open.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const started = game.execute('open');
    await Promise.resolve();
    advance(200_000);
    expect((await game.status()).phase).toBe('starting');
    await expect(game.execute('close')).rejects.toThrow();
    finish();
    await started;
  });

  it.each(['checking', 'recording', 'saving'])(
    'не закрывает игру во время этапа %s',
    async (phase) => {
      const { game, port } = setup();
      const routes = createGameRoutes(game, {
        path: '/api/capture/status',
        handle: async () => ({ phase }),
      });
      const close = routes.find((route) => route.path.endsWith('/close'))!;
      expect(close.method).toBe('POST');
      await expect(close.handle(new URLSearchParams(), '')).rejects.toThrow('остановите запись');
      expect(port.close).not.toHaveBeenCalled();
    },
  );
});
