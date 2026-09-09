import {
  buildLaunchScript,
  InvalidReplayRunError,
  manualSeekCommand,
  usableReplays,
  type ReplayRun,
} from '../../domain/gameconfig/replay-run.ts';
import type { ReplayFile } from '../../domain/gameconfig/benchmark-plan.ts';
import type { GameLauncher } from '../ports/game-launcher.port.ts';

/**
 * Эталонный прогон: запустить игру с нужным повтором.
 *
 * Сценарий помнит последний запущенный прогон, и это не удобство, а суть всей
 * затеи. Запись кадров потом берёт сцену отсюда, а не из слов человека: файл
 * повтора и тик известны точно, потому что мы сами их и задали.
 *
 * Память живёт ровно пока идёт игра. Закрыл Dota — прогона больше нет, и
 * следующая запись снова будет «сценой не указана». Помечать живой матч как
 * повтор, потому что час назад запускали прогон, — ровно та ошибка, из-за
 * которой всё это и затевалось.
 */

export interface ReplayRunState {
  /** Прогон, который сейчас идёт. `null` — игра не запущена нами. */
  readonly current: ReplayRun | null;
  /** Куда положен файл команд. */
  readonly configPath: string | null;
  /** Что человеку сделать руками. */
  readonly steps: readonly string[];
  /** Команда на случай, если движок не остановился на тике. */
  readonly manualSeek: string | null;
  readonly gameRunning: boolean;
}

export interface ReplayRunOptions {
  readonly ready: boolean;
  readonly obstacles: readonly string[];
  readonly replays: readonly ReplayFile[];
  readonly state: ReplayRunState;
}

const NOTHING_RUNNING: ReplayRunState = {
  current: null,
  configPath: null,
  steps: [],
  manualSeek: null,
  gameRunning: false,
};

export class StartReplayRun {
  readonly #launcher: GameLauncher;
  #current: ReplayRun | null = null;
  #configPath: string | null = null;
  #steps: readonly string[] = [];

  constructor(launcher: GameLauncher) {
    this.#launcher = launcher;
  }

  /** Что можно запустить и что уже запущено. */
  async options(): Promise<ReplayRunOptions> {
    const targets = await this.#launcher.targets();
    return {
      ready: targets.ready,
      obstacles: targets.obstacles,
      replays: usableReplays(targets.replays),
      state: await this.state(),
    };
  }

  async execute(run: ReplayRun): Promise<ReplayRunState> {
    if (await this.#launcher.isGameRunning()) {
      throw new InvalidReplayRunError(
        'Dota уже запущена. Команды прогона выполняются при старте игры, ' +
          'поэтому её нужно закрыть — иначе повтор не загрузится, а мы решим, ' +
          'что загрузился.',
      );
    }

    const script = buildLaunchScript(run);
    this.#configPath = await this.#launcher.launch(script.configLines, script.launchArgs);
    this.#current = run;
    this.#steps = script.steps;

    return this.state();
  }

  /**
   * Сцена текущего прогона — то, чем помечать запись.
   *
   * `null`, если игра закрыта: прогон закончился вместе с ней.
   */
  async currentRun(): Promise<ReplayRun | null> {
    return (await this.state()).current;
  }

  async state(): Promise<ReplayRunState> {
    const gameRunning = await this.#launcher.isGameRunning();
    if (!gameRunning) {
      this.#current = null;
      this.#steps = [];
      return NOTHING_RUNNING;
    }
    if (this.#current === null) {
      // Игра идёт, но запускали её не мы — сцену мы не знаем и врать не станем.
      return { ...NOTHING_RUNNING, gameRunning: true };
    }

    return {
      current: this.#current,
      configPath: this.#configPath,
      steps: this.#steps,
      manualSeek: manualSeekCommand(this.#current),
      gameRunning: true,
    };
  }
}
