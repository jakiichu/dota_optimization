import { describe, expect, it } from 'vitest';
import { StartReplayRun } from '../../src/application/use-cases/start-replay-run.ts';
import type {
  GameLaunchTargets,
  GameLauncher,
} from '../../src/application/ports/game-launcher.port.ts';

class FakeLauncher implements GameLauncher {
  running = false;
  launched: { lines: readonly string[]; args: readonly string[] } | null = null;

  targets(): Promise<GameLaunchTargets> {
    return Promise.resolve({
      ready: true,
      configPath: 'C:/dota/cfg/frameloss-bench.cfg',
      obstacles: [],
      replays: [
        {
          name: '8865634649.dem',
          sizeBytes: 200_000_000,
          ticks: 176_355,
          durationSeconds: 5879,
        },
      ],
    });
  }

  isGameRunning(): Promise<boolean> {
    return Promise.resolve(this.running);
  }

  launch(configLines: readonly string[], launchArgs: readonly string[]): Promise<string> {
    this.launched = { lines: configLines, args: launchArgs };
    // Steam открывает игру не мгновенно, но для сценария важно только то, что
    // после запуска она считается идущей.
    this.running = true;
    return Promise.resolve('C:/dota/cfg/frameloss-bench.cfg');
  }
}

const RUN = { replayFile: '8865634649.dem', startTick: 42000, label: 'до правки' };

describe('StartReplayRun', () => {
  it('не запускает поверх идущей игры', async () => {
    // Команды прогона выполняются при старте игры. Запустив поверх открытой,
    // мы бы получили не тот повтор — и пометили запись сценой, которой нет.
    const launcher = new FakeLauncher();
    launcher.running = true;
    const run = new StartReplayRun(launcher);

    await expect(run.execute(RUN)).rejects.toThrow('уже запущена');
    expect(launcher.launched).toBeNull();
  });

  it('после запуска знает сцену сам, без слов человека', async () => {
    const run = new StartReplayRun(new FakeLauncher());

    await run.execute(RUN);

    expect(await run.currentRun()).toEqual(RUN);
  });

  it('забывает прогон, когда игру закрыли', async () => {
    // Иначе живой матч через час получил бы пометку «повтор с тика 42000» —
    // ровно та ошибка, ради которой всё это и делалось.
    const launcher = new FakeLauncher();
    const run = new StartReplayRun(launcher);
    await run.execute(RUN);

    launcher.running = false;

    expect(await run.currentRun()).toBeNull();
  });

  it('не выдумывает сцену для игры, запущенной не нами', async () => {
    const launcher = new FakeLauncher();
    launcher.running = true;
    const run = new StartReplayRun(launcher);

    const state = await run.state();

    expect(state.gameRunning).toBe(true);
    expect(state.current).toBeNull();
  });

  it('отдаёт годные повторы и то, что мешает запуску', async () => {
    const run = new StartReplayRun(new FakeLauncher());

    const options = await run.options();

    expect(options.ready).toBe(true);
    expect(options.replays.map((replay) => replay.name)).toEqual(['8865634649.dem']);
  });
});
