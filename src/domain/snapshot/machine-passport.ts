import { parseGameConfig } from '../gameconfig/game-config.ts';
import type { Maybe, SystemSnapshot } from './system-snapshot.ts';

/**
 * Состояние машины на момент записи.
 *
 * Появился из дыры, которая подрывала проверку гипотез. В записи лежали кадры,
 * сенсоры и сцена — и ничего о самой машине. Значит, сравнивая две записи, мы
 * не могли сказать, чем они отличались, а приговор «подтвердилась» выносился и
 * тогда, когда человек вместе с `fps_max` поменял ещё пять настроек. Проверка
 * выглядела строгой, но главное условие опыта — что менялось только
 * предсказанное — не проверялось вовсе.
 *
 * Паспорт намеренно узкий, а не «весь снимок». Записи носят с машины на машину
 * и прикладывают к письмам, и превращать каждую в подробную опись компьютера
 * незачем. Здесь только то, что меняют ради кадров и что человек мог поменять
 * между двумя замерами.
 *
 * Список плоский — «ключ, название, значение». Так две записи вычитаются одна
 * из другой без знания о том, какие поля бывают: новое правило добавит свою
 * строку, и сравнение подхватит её само.
 */

export interface MachineSetting {
  /** Устойчивый ключ для сравнения. Меняется — рвётся история. */
  readonly key: string;
  /** Как назвать человеку. */
  readonly label: string;
  /** Значение словами: «включено», «59», «Высокая производительность». */
  readonly value: string;
}

export interface MachinePassport {
  readonly settings: readonly MachineSetting[];
}

export const EMPTY_PASSPORT: MachinePassport = { settings: [] };

/** Настройка появилась, исчезла или поменяла значение. */
export interface PassportChange {
  readonly key: string;
  readonly label: string;
  /** `null` — настройки не было в первой записи. */
  readonly before: string | null;
  /** `null` — настройки нет во второй. */
  readonly after: string | null;
}

/** Приставка у ключей настроек игры: отличает их от настроек Windows. */
const CVAR_PREFIX = 'cvar:';

export function isGameSetting(change: PassportChange): boolean {
  return change.key.startsWith(CVAR_PREFIX);
}

/** Имя переменной игры из ключа паспорта. `null` — это не настройка игры. */
export function cvarOf(change: PassportChange): string | null {
  return isGameSetting(change) ? change.key.slice(CVAR_PREFIX.length) : null;
}

export function passportFrom(snapshot: SystemSnapshot): MachinePassport {
  const settings: MachineSetting[] = [];
  const add = (key: string, label: string, value: Maybe<string>): void => {
    // Непрочитанное не записываем вовсе: «не читали» и «выключено» — разные
    // вещи, и в сравнении первое выглядело бы как изменение настройки.
    if (value !== null) settings.push({ key, label, value });
  };

  const game = snapshot.games.find((candidate) => candidate.config !== null);
  if (game?.config != null && game.configPath != null) {
    for (const setting of parseGameConfig(game.configPath, game.config).settings) {
      // Побеждает последняя: движок выполняет файл сверху вниз.
      const key = `${CVAR_PREFIX}${setting.name.toLowerCase()}`;
      const at = settings.findIndex((existing) => existing.key === key);
      const entry = { key, label: setting.name, value: setting.value };
      if (at === -1) settings.push(entry);
      else settings[at] = entry;
    }
  }

  add('game.launchOptions', 'Параметры запуска', game?.launchOptions ?? null);

  const display = highestRefresh(snapshot.displays);
  add('display.refreshHz', 'Частота экрана, Гц', display === null ? null : String(display));

  add('power.scheme', 'Схема электропитания', snapshot.power.activeSchemeName);
  add(
    'power.minCores',
    'Минимум активных ядер, %',
    numberOf(snapshot.power.minProcessorCoresPercentAc),
  );
  add('power.onBattery', 'От батареи', flagOf(snapshot.power.onBattery));

  add('graphics.hags', 'Аппаратное планирование GPU', onOff(snapshot.graphics.hwSchMode, 2));
  add('graphics.mpo', 'MPO отключён', onOff(snapshot.graphics.overlayTestMode, 5));
  add('graphics.gameDvr', 'Игровая запись DVR', onOff(snapshot.graphics.gameDvrEnabled, 1));
  add('graphics.gameMode', 'Игровой режим', onOff(snapshot.graphics.autoGameModeEnabled, 1));
  add(
    'security.hvci',
    'Целостность памяти',
    onOff(snapshot.security.hypervisorEnforcedCodeIntegrityEnabled, 1),
  );

  const gpu = snapshot.gpus[0];
  add('gpu.name', 'Видеокарта', gpu?.name ?? null);
  add('gpu.driver', 'Версия драйвера', gpu?.driverVersion ?? null);

  return { settings };
}

/**
 * Чем вторая запись отличается от первой.
 *
 * Появление и исчезновение настройки — такие же изменения, как смена значения:
 * убранная из конфига строка меняет игру ровно так же, как исправленная.
 */
export function diffPassports(
  before: MachinePassport,
  after: MachinePassport,
): readonly PassportChange[] {
  const was = new Map(before.settings.map((setting) => [setting.key, setting]));
  const now = new Map(after.settings.map((setting) => [setting.key, setting]));

  const changes: PassportChange[] = [];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const from = was.get(key) ?? null;
    const to = now.get(key) ?? null;
    if (from?.value === to?.value) continue;

    changes.push({
      key,
      label: to?.label ?? from?.label ?? key,
      before: from?.value ?? null,
      after: to?.value ?? null,
    });
  }

  return changes.sort((left, right) => left.label.localeCompare(right.label, 'ru'));
}

function onOff(value: Maybe<number>, enabled: number): Maybe<string> {
  if (value === null) return null;
  return value === enabled ? 'включено' : 'выключено';
}

function flagOf(value: Maybe<boolean>): Maybe<string> {
  return value === null ? null : value ? 'да' : 'нет';
}

function numberOf(value: Maybe<number>): Maybe<string> {
  return value === null ? null : String(value);
}

/**
 * Самый быстрый из подключённых выходов.
 *
 * Игра идёт на одном мониторе, но какой это — снимок не знает. Берём
 * наибольшую частоту: та же логика, что и в рекомендациях.
 */
function highestRefresh(
  displays: readonly { readonly currentRefreshHz: Maybe<number> }[],
): number | null {
  const rates = displays
    .map((display) => display.currentRefreshHz)
    .filter((rate): rate is number => rate !== null && rate > 0);
  return rates.length === 0 ? null : Math.max(...rates);
}
