/**
 * Как сделать замер, который можно повторить.
 *
 * Возникло из вполне конкретной беды: записи делались в пробе героя, в начале
 * игры и в затяжном замесе, а сравнивались между собой. Разница нагрузки между
 * сценами больше любого эффекта от настроек, и выводы из такого сравнения
 * ничего не стоят.
 *
 * Dota умеет решать это сама. В её собственном `perftest.cfg` Valve использует
 * `demo_marktick` и `demo_gotomark`, чтобы каждый прогон начинался с одной и
 * той же точки повтора. Повтор проигрывает одни и те же кадры — те же эффекты,
 * те же юниты, ту же нагрузку.
 */

export interface ReplayFile {
  readonly name: string;
  readonly sizeBytes: number;
}

export interface BenchmarkPlan {
  /** Команды, которые вводятся в консоль игры по порядку. */
  readonly consoleCommands: readonly string[];
  /** Что делать человеку — по шагам. */
  readonly steps: readonly string[];
  /** Команда запуска записи в нашем инструменте. */
  readonly captureCommand: string;
}

/** Сколько ждать после перемотки, прежде чем мерить: движок догружает сцену. */
const SETTLE_SECONDS = 5;

/**
 * План замера по повтору.
 *
 * Консоль в Dota включается в настройках, а команды вводятся руками: мы
 * намеренно не посылаем нажатия в окно игры. Инструмент читает и советует, но
 * в чужой процесс не лезет — это граница, за которой начинаются проблемы с
 * античитом.
 */
export function planReplayBenchmark(
  replay: string,
  startTick: number,
  seconds: number,
  label: string,
): BenchmarkPlan {
  const consoleCommands = [
    `playdemo ${replay.replace(/\.dem$/i, '')}`,
    `demo_gototick ${startTick}`,
    'demo_pause',
  ];

  return {
    consoleCommands,
    steps: [
      'Открыть консоль в игре (настройки → расширенные, если она выключена).',
      `Выполнить: ${consoleCommands.join(' ; ')}`,
      `Дождаться, пока сцена догрузится — секунд ${SETTLE_SECONDS}.`,
      'Снять паузу командой demo_resume и сразу запустить запись.',
      'Повторить ровно те же шаги после изменения настроек.',
    ],
    captureCommand:
      `npm run capture -- --seconds ${seconds} --scene replay ` +
      `--replay ${replay} --tick ${startTick} --label "${label}"`,
  };
}

/**
 * Годится ли повтор для замера.
 *
 * Пустые и обрезанные файлы попадаются: Dota оставляет заготовки, а прерванная
 * загрузка даёт файл, который проиграется до середины и оборвётся.
 */
const MIN_USABLE_BYTES = 1024 * 1024;

export function isUsableReplay(replay: ReplayFile): boolean {
  return replay.name.toLowerCase().endsWith('.dem') && replay.sizeBytes >= MIN_USABLE_BYTES;
}
