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
    // Steam открывает игру десятки секунд: сразу после запуска процесса ещё
    // нет, и именно на этом ломалась первая версия.
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

  it('не забывает прогон, пока Steam поднимает игру', async () => {
    // Первая версия стирала прогон первой же проверкой: процесса ещё нет,
    // значит «ничего не запущено». Интерфейс показывал пустоту, человек решал,
    // что кнопка не работает, а запись потом оставалась без сцены.
    const launcher = new FakeLauncher();
    const run = new StartReplayRun(launcher);

    const state = await run.execute(RUN);

    expect(state.status).toBe('starting');
    expect(state.current).toEqual(RUN);
    expect(await run.currentRun()).toEqual(RUN);
  });

  it('переходит в «идёт», когда игра появилась', async () => {
    const launcher = new FakeLauncher();
    const run = new StartReplayRun(launcher);
    await run.execute(RUN);

    launcher.running = true;

    const state = await run.state();
    expect(state.status).toBe('running');
    expect(state.current).toEqual(RUN);
  });

  it('после запуска знает сцену сам, без слов человека', async () => {
    const launcher = new FakeLauncher();
    const run = new StartReplayRun(launcher);

    await run.execute(RUN);
    launcher.running = true;

    expect(await run.currentRun()).toEqual(RUN);
  });

  it('забывает прогон, когда игру закрыли', async () => {
    // Иначе живой матч через час получил бы пометку «повтор с тика 42000» —
    // ровно та ошибка, ради которой всё это и делалось.
    const launcher = new FakeLauncher();
    const run = new StartReplayRun(launcher);
    await run.execute(RUN);

    // Игра успела появиться и закрыться: это уже конец прогона, а не запуск.
    launcher.running = true;
    await run.state();
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
