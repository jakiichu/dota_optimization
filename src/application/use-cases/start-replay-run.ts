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
 *
 * Но «пока идёт игра» начинается не сразу. Steam поднимает Dota десятки секунд,
 * и первая же проверка после запуска не находит процесса. Первая версия на этом
 * и ломалась: она стирала только что заведённый прогон, интерфейс показывал
 * пустоту, и человек справедливо решал, что кнопка не работает. Хуже того — к
 * моменту появления игры прогон был уже забыт, и запись оставалась без сцены.
 *
 * Поэтому у прогона три состояния, а не два: пока игра не появилась, он
 * «запускается», и забывается только если так и не появился.
 */

export type ReplayRunStatus =
  /** Ничего не запущено. */
  | 'idle'
  /** Steam попросили открыть игру, процесса ещё нет. */
  | 'starting'
  /** Игра идёт. */
  | 'running';

export interface ReplayRunState {
  readonly status: ReplayRunStatus;
  /** Прогон, который сейчас идёт или запускается. `null` — запускали не мы. */
  readonly current: ReplayRun | null;
  /** Сколько секунд ждём появления игры. `null` — не ждём. */
  readonly waitingSeconds: number | null;
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
  status: 'idle',
  current: null,
  waitingSeconds: null,
  configPath: null,
  steps: [],
  manualSeek: null,
  gameRunning: false,
};

/**
 * Сколько ждём появления игры после просьбы к Steam.
 *
 * Три минуты: холодный запуск Steam с обновлением библиотеки и загрузкой Dota
 * столько и занимает. Не дождавшись, честно говорим об этом — молча забыть
 * прогон значит вернуть ту же пустоту, из-за которой кнопка казалась сломанной.
 */
const STARTUP_GRACE_MS = 3 * 60 * 1000;

export class StartReplayRun {
  readonly #launcher: GameLauncher;
  #current: ReplayRun | null = null;
  #configPath: string | null = null;
  #steps: readonly string[] = [];
  /** Когда попросили Steam открыть игру. */
  #askedAt = 0;
  /** Видели ли мы процесс игры после этой просьбы. */
  #seenRunning = false;

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
    this.#askedAt = Date.now();
    this.#seenRunning = false;

    return this.state();
  }

  /**
   * Сцена текущего прогона — то, чем помечать запись.
   *
   * `null`, если игра закрыта: прогон закончился вместе с ней. Пока игра только
   * поднимается, сцена уже известна — записывать всё равно нечего, но и терять
   * её незачем.
   */
  async currentRun(): Promise<ReplayRun | null> {
    return (await this.state()).current;
  }

  async state(): Promise<ReplayRunState> {
    const gameRunning = await this.#launcher.isGameRunning();
    if (gameRunning) this.#seenRunning = true;

    // Игру ещё не видели, и ждём мы недолго — значит она поднимается.
    const waited = Date.now() - this.#askedAt;
    const starting =
      !gameRunning && this.#current !== null && !this.#seenRunning && waited < STARTUP_GRACE_MS;

    if (!gameRunning && !starting) {
      this.#forget();
      return NOTHING_RUNNING;
    }

    if (this.#current === null) {
      // Игра идёт, но запускали её не мы — сцену мы не знаем и врать не станем.
      return { ...NOTHING_RUNNING, status: 'running', gameRunning: true };
    }

    return {
      status: starting ? 'starting' : 'running',
      current: this.#current,
      waitingSeconds: starting ? Math.round(waited / 1000) : null,
      configPath: this.#configPath,
      steps: this.#steps,
      manualSeek: manualSeekCommand(this.#current),
      gameRunning,
    };
  }

  #forget(): void {
    this.#current = null;
    this.#steps = [];
    this.#seenRunning = false;
    this.#askedAt = 0;
  }
}
