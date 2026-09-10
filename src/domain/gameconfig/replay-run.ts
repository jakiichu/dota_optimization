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
 * Тика здесь нет, и это не упущение: **начальный тик воспроизведения движку
 * задать нечем**. Все команды перемотки — `demo_gototick`, `demo_goto`,
 * `demo_gotomark` — описаны как «skips the **current** demo playback», то есть
 * работают только по уже идущему повтору. Файл команд выполняется при запуске
 * игры, когда никакого повтора ещё нет.
 *
 * `demo_pauseatservertick` тут тоже не годится, хотя выставляется заранее: он
 * не перематывает, а ждёт — «pauses when the render time reaches the tick».
 * Заказав тридцатую минуту, человек полчаса смотрел бы повтор с начала, чтобы
 * тот замер в нужном месте. Мы это попробовали, и вышло ровно так.
 *
 * Поэтому перемотка честно отдаётся человеку одной строкой в консоль, а
 * `demo_usefastgoto` заранее включает быстрый пропуск кадров, чтобы прыжок был
 * мгновенным. Консоль открывается сразу: `-console` в параметрах запуска.
 */
export function buildLaunchScript(run: ReplayRun): LaunchScript {
  validateReplayRun(run);

  const demo = `${REPLAY_FOLDER}/${run.replayFile.replace(/\.dem$/i, '')}`;
  const configLines = [
    '// Создан frameloss для эталонного прогона. Файл перезаписывается при',
    '// каждом запуске — свои команды сюда добавлять не стоит.',
    '// Быстрый пропуск кадров: без него перемотка внутри повтора идёт минутами.',
    'demo_usefastgoto 1',
    `playdemo ${demo}`,
  ];

  return {
    configLines,
    // -console: перемотку всё равно вводить руками, и пусть окно для неё уже
    // будет открыто.
    launchArgs: ['-applaunch', DOTA_APP_ID, '-console', '+exec', BENCHMARK_CONFIG_NAME],
    steps: stepsFor(run),
  };
}

/**
 * Что человеку сделать руками.
 *
 * Шаг с записью называет кнопку прямым текстом и стоит в списке всегда. Раньше
 * без тика он звучал как «запись можно запускать сразу» — предложение, из
 * которого не следует, что где-то есть вторая кнопка и нажать её надо самому.
 * Запуск игры и запись — два разных действия, и между ними игра занимает весь
 * экран; не сказать об этом значит оставить человека с ощущением, что прогон
 * ничего не сделал.
 */
function stepsFor(run: ReplayRun): readonly string[] {
  const steps = ['Дождаться, пока повтор загрузится.'];

  if (run.startTick !== null) {
    steps.push(
      `Выполнить в консоли: demo_gototick ${run.startTick} — она уже открыта.`,
      'Прыжок мгновенный: быстрый пропуск кадров включён заранее.',
    );
  }

  steps.push(
    run.startTick === null
      ? 'Вернуться сюда и нажать «Записать прогон».'
      : 'Вернуться сюда и нажать «Записать прогон», когда повтор пойдёт с нужного места.',
    'Пока идёт отсчёт — вернуться в игру: свёрнутая Dota рисует иначе, и запись об этом.',
  );

  steps.push('После правки настроек повторить то же самое: файл и тик уже заданы.');
  return steps;
}

/**
 * Строка перемотки для консоли.
 *
 * Это единственная часть прогона, которую человек делает руками, и обойти её
 * нельзя: начальный тик воспроизведения движку не задаётся.
 */
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
