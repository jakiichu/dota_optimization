import { configFrom } from '../domain/telemetry/capture-analysis.ts';
import { UNKNOWN_MACHINE, type MachineContext } from '../domain/gameconfig/machine-context.ts';
import {
  EMPTY_PASSPORT,
  passportFrom,
  type MachinePassport,
} from '../domain/snapshot/machine-passport.ts';
import { WindowsSnapshotCollector } from '../infrastructure/windows/windows-snapshot.collector.ts';

/**
 * Конфиг игры на момент разбора.
 *
 * Читается через тот же сбор снимка, что и аудит: искать autoexec.cfg по
 * второму разу значило бы держать две реализации поиска Steam-библиотек.
 *
 * Сбор занимает пару секунд, поэтому результат кешируется — между записями
 * конфиг меняется редко, а платить за него при каждом открытии записи незачем.
 * Источник один на всё приложение: два независимых кеша означали бы два
 * запуска PowerShell и два расходящихся представления об одной машине.
 */
export interface MachineContextSource {
  get(): Promise<MachineContext>;
  /**
   * Состояние машины для записи.
   *
   * Из того же снимка, что и остальное: собирать его второй раз ради паспорта
   * значило бы платить секундами за уже прочитанное.
   */
  passport(): Promise<MachinePassport>;
  /**
   * Забыть прочитанное.
   *
   * Нужно ровно после правки конфига: иначе рекомендации будут отговариваться
   * тем, что настройка «уже стоит», глядя на файл, которого больше нет.
   */
  forget(): void;
}

export function createMachineContextSource(): MachineContextSource {
  let cached: Promise<Read> | null = null;
  const read = (): Promise<Read> => (cached ??= readMachine());

  return {
    get: async () => (await read()).context,
    passport: async () => (await read()).passport,
    forget: () => {
      cached = null;
    },
  };
}

interface Read {
  readonly context: MachineContext;
  readonly passport: MachinePassport;
}

async function readMachine(): Promise<Read> {
  try {
    const snapshot = await new WindowsSnapshotCollector().collect();
    const game = snapshot.games.find((candidate) => candidate.config !== null);
    return {
      context: {
        config: game === undefined ? null : configFrom(game.configPath, game.config),
        displayHz: highestRefresh(snapshot.displays),
      },
      passport: passportFrom(snapshot),
    };
  } catch {
    // Без этих сведений рекомендации просто будут осторожнее, а запись
    // останется без паспорта — и сравнение честно скажет, что не знает, что
    // менялось.
    return { context: UNKNOWN_MACHINE, passport: EMPTY_PASSPORT };
  }
}

/**
 * Самый быстрый из подключённых выходов.
 *
 * Игра идёт на одном мониторе, но какой из них — снимок не знает. Берём
 * наибольшую частоту: ошибиться в сторону меньшей значило бы посоветовать
 * потолок ниже, чем экран может показать.
 */
function highestRefresh(
  displays: readonly { currentRefreshHz: number | null }[],
): number | null {
  const rates = displays
    .map((display) => display.currentRefreshHz)
    .filter((rate): rate is number => rate !== null && rate > 0);
  return rates.length === 0 ? null : Math.max(...rates);
}
