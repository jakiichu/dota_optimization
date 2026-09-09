import type { ReplayFile } from './benchmark-plan.ts';

/**
 * Эталонный прогон: игра запускается сразу с нужным повтором.
 *
 * До сих пор сцену описывал человек — выбирал вид, вписывал файл и тик. Мы
 * верили на слово, и первое же сравнение развалилось именно на этом: записи
 * делались в разных местах матча, а помечены были одинаково.
 *
 * Здесь сцену задаём мы. Приложение само пишет команды в cfg и само зовёт
 * Steam, а значит знает файл повтора и тик не со слов, а потому что само их
 * туда и положило. Поле «сцена» перестаёт быть анкетой.
 *
 * Границу это не двигает: в чужой процесс мы по-прежнему не лезем и нажатий в
 * окно игры не шлём. Запуск через Steam с параметрами — то же самое, что
 * нажать «Играть», только параметры пишем не руками.
 */

export interface ReplayRun {
  /** Имя файла в папке повторов, как есть: `8865634649.dem`. */
  readonly replayFile: string;
  /** Тик, с которого мерить. `null` — с начала повтора. */
  readonly startTick: number | null;
  readonly label: string;
}

export interface LaunchScript {
  /** Строки cfg, который выполнит игра при запуске. */
  readonly configLines: readonly string[];
  /** Аргументы для steam.exe. */
  readonly launchArgs: readonly string[];
  /**
   * Что остаётся сделать человеку.
   *
   * Список короткий, но не пустой, и делать вид, что прогон полностью
   * автоматический, нельзя: перемотка внутри повтора — единственное место, где
   * мы не можем ручаться за движок.
   */
  readonly steps: readonly string[];
}

/** Идентификатор Dota 2 в Steam. */
const DOTA_APP_ID = '570';

/** Имя нашего cfg. Отдельный файл: autoexec игрока мы для этого не трогаем. */
export const BENCHMARK_CONFIG_NAME = 'frameloss-bench';

/** Где игра держит повторы относительно папки с cfg. */
const REPLAY_FOLDER = 'replays';

/**
 * Что запрещено в имени повтора.
 *
 * Имя уходит двумя путями: в путь файла и в строку cfg, которую выполнит
 * движок. Второе опаснее — перевод строки или точка с запятой превратили бы
 * имя файла в дописанную консольную команду. Поэтому имена не чистим, а
 * отвергаем: молча искалеченное имя хуже честного отказа.
 */
const UNSAFE_IN_REPLAY = /[^A-Za-z0-9_.\- ]/;

/** Меньше мегабайта — это обрезок, а не повтор. */
const MIN_USABLE_BYTES = 1024 * 1024;

export class InvalidReplayRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReplayRunError';
  }
}

export function validateReplayRun(run: ReplayRun): void {
  const name = run.replayFile.trim();
  if (name === '') {
    throw new InvalidReplayRunError('Не выбран повтор.');
  }
  if (!name.toLowerCase().endsWith('.dem')) {
    throw new InvalidReplayRunError(`Повтор должен быть файлом .dem, а не «${name}».`);
  }
  if (UNSAFE_IN_REPLAY.test(name)) {
    throw new InvalidReplayRunError(
      `В имени повтора есть символы, которых там быть не может: «${name}».`,
    );
  }
  if (run.startTick !== null && (!Number.isInteger(run.startTick) || run.startTick < 0)) {
    throw new InvalidReplayRunError('Тик должен быть целым неотрицательным числом.');
  }
}

/**
 * Команды прогона и параметры запуска.
 *
 * Порядок строк — не вкусовщина. `playdemo` загружает повтор не мгновенно, и
 * команда, поставленная следующей строкой, уходит в ещё не начавшееся
 * воспроизведение. Поэтому всё, что можно выставить заранее, выставляется до
 * него: остановка на нужном тике — это условие, которое движок проверяет по
 * ходу, а не действие в момент вызова.
 *
 * `demo_gototick` в cfg не кладём именно по этой причине: он бы промахнулся
 * мимо ещё не загруженного повтора. Его отдаём человеку строкой для консоли —
 * на случай, если остановка не сработает.
 */
export function buildLaunchScript(run: ReplayRun): LaunchScript {
  validateReplayRun(run);

  const demo = `${REPLAY_FOLDER}/${run.replayFile.replace(/\.dem$/i, '')}`;
  const configLines = [
    '// Создан frameloss для эталонного прогона. Файл перезаписывается при',
    '// каждом запуске — свои команды сюда добавлять не стоит.',
    'demo_usefastgoto 1',
  ];

  if (run.startTick !== null) {
    configLines.push(`demo_pauseatservertick ${run.startTick}`);
  }
  configLines.push(`playdemo ${demo}`);

  return {
    configLines,
    launchArgs: ['-applaunch', DOTA_APP_ID, '+exec', BENCHMARK_CONFIG_NAME],
    steps: stepsFor(run),
  };
}

function stepsFor(run: ReplayRun): readonly string[] {
  const steps = ['Дождаться, пока повтор загрузится.'];

  if (run.startTick === null) {
    steps.push('Повтор пойдёт с начала: запись можно запускать сразу.');
  } else {
    steps.push(
      `Игра должна остановиться на тике ${run.startTick}. Если этого не ` +
        `произошло — выполнить в консоли: demo_gototick ${run.startTick}`,
      'Снять паузу (пробел) и сразу нажать «Записать».',
    );
  }

  steps.push('После правки настроек повторить то же самое: файл и тик уже заданы.');
  return steps;
}

/** Строка для консоли на случай, если остановка на тике не сработала. */
export function manualSeekCommand(run: ReplayRun): string | null {
  return run.startTick === null ? null : `demo_gototick ${run.startTick}`;
}

/**
 * Годится ли повтор для прогона.
 *
 * Обрезанные файлы попадаются: прерванная загрузка оставляет `.dem.partial`, а
 * Dota кладёт рядом пустые заготовки. Проигрываться такой будет до середины и
 * оборвётся посреди замера.
 */
export function usableReplays(replays: readonly ReplayFile[]): readonly ReplayFile[] {
  return replays.filter(
    (replay) =>
      replay.name.toLowerCase().endsWith('.dem') &&
      !UNSAFE_IN_REPLAY.test(replay.name) &&
      replay.sizeBytes >= MIN_USABLE_BYTES,
  );
}
