import { findSetting, type CvarSetting, type GameConfig } from './game-config.ts';

/**
 * Чужой конфиг, приложенный к своему, — до того, как он что-то перезапишет.
 *
 * Конфиги из гайдов вставляют целиком, и прежде инструмент умел только это:
 * заменить файл. Разбор при этом шёл уже по записанному, когда спрашивать
 * «а что из этого мне нужно» было поздно. Здесь ответ даётся заранее, и по
 * каждой строке отдельно: что она поменяет именно у вас.
 *
 * Отдельно считаются строки, которые не поменяют **ничего**: значение у вас уже
 * такое же, или ниже в том же файле стоит другая строка с той же настройкой.
 * Гайд обещает за них кадры, а движок их даже не заметит — и об этом стоит
 * знать до записи, а не после замера.
 *
 * Есть ли такая переменная в игре вообще, отсюда не видно: список знает только
 * сам движок. Без него говорим «не проверяли», а не «существует».
 */

export type ReviewVerdict =
  /** У вас уже стоит то же значение: строка ничего не изменит. */
  | 'already'
  /** У вас другое значение — строка его заменит. */
  | 'changes'
  /** У вас настройка не задана — строка её добавит. */
  | 'adds'
  /** Ниже в этом же конфиге её перекрывает другая строка. */
  | 'shadowed'
  /** Не настройка, а команда: бинд, псевдоним, вызов другого файла. */
  | 'command';

export interface ReviewLine {
  /** Строка чужого конфига; номер строки — во вставленном тексте. */
  readonly setting: CvarSetting;
  readonly verdict: ReviewVerdict;
  /** Что стоит у вас сейчас. `null` — не задано или своего конфига нет. */
  readonly ownValue: string | null;
}

export interface ConfigReview {
  readonly lines: readonly ReviewLine[];
  /** Сколько строк чужого конфига вообще что-то поменяют у вас. */
  readonly effective: number;
  /** Сколько строк не поменяют ничего: совпали или перекрыты. */
  readonly idle: number;
}

/**
 * Команды консоли, которые не настройки.
 *
 * Правка конфига устроена как «имя — значение», и `bind` в неё не ложится: два
 * разных бинда — это одно имя, и второй молча затёр бы первый. Поэтому такие
 * строки показываются, но в черновик не переносятся — их человек переписывает
 * руками, если они ему нужны.
 */
const COMMANDS = new Set([
  'alias',
  'bind',
  'bind_osx',
  'bindtoggle',
  'connect',
  'echo',
  'exec',
  'host_writeconfig',
  'incrementvar',
  'playdemo',
  'say',
  'say_team',
  'toggle',
  'unbind',
  'unbindall',
]);

export function isConsoleCommand(name: string): boolean {
  return COMMANDS.has(name.toLowerCase());
}

/**
 * @param own — свой конфиг; `null`, если его нет. Тогда всё, что не команда и
 *   не перекрыто, честно «добавится»: сравнивать не с чем.
 */
export function reviewForeignConfig(foreign: GameConfig, own: GameConfig | null): ConfigReview {
  const lines = foreign.settings.map((setting) => reviewLine(setting, foreign, own));

  return {
    lines,
    effective: lines.filter((line) => line.verdict === 'changes' || line.verdict === 'adds').length,
    idle: lines.filter((line) => line.verdict === 'already' || line.verdict === 'shadowed').length,
  };
}

function reviewLine(setting: CvarSetting, foreign: GameConfig, own: GameConfig | null): ReviewLine {
  const ownSetting = own === null ? undefined : findSetting(own, setting.name);
  const ownValue = ownSetting?.value ?? null;

  return {
    setting,
    verdict: verdictOf(setting, foreign, ownValue),
    // Сравниваем со своим, только если это настройка: у бинда «своё значение»
    // было бы значением совсем другой клавиши.
    ownValue: isConsoleCommand(setting.name) ? null : ownValue,
  };
}

function verdictOf(
  setting: CvarSetting,
  foreign: GameConfig,
  ownValue: string | null,
): ReviewVerdict {
  if (isConsoleCommand(setting.name)) return 'command';
  // Движок выполняет файл сверху вниз: в силе останется последняя строка.
  if (findSetting(foreign, setting.name)?.line !== setting.line) return 'shadowed';
  if (ownValue === null) return 'adds';
  return sameValue(ownValue, setting.value) ? 'already' : 'changes';
}

/**
 * Одно ли это значение для движка.
 *
 * `fps_max "120"` и `fps_max 120`, `1.0` и `1` — одно и то же. Сравнив их как
 * строки, мы пообещали бы правку там, где её нет, и записали бы файл с
 * резервной копией ради кавычек.
 */
export function sameValue(left: string, right: string): boolean {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;

  const numberA = Number(a);
  const numberB = Number(b);
  return a !== '' && b !== '' && Number.isFinite(numberA) && numberA === numberB;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
