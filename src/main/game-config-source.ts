import { configFrom } from '../domain/telemetry/capture-analysis.ts';
import { UNKNOWN_MACHINE, type MachineContext } from '../domain/gameconfig/machine-context.ts';
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
   * Забыть прочитанное.
   *
   * Нужно ровно после правки конфига: иначе рекомендации будут отговариваться
   * тем, что настройка «уже стоит», глядя на файл, которого больше нет.
   */
  forget(): void;
}

export function createMachineContextSource(): MachineContextSource {
  let cached: Promise<MachineContext> | null = null;

  return {
    get: () => (cached ??= read()),
    forget: () => {
      cached = null;
    },
  };
}

async function read(): Promise<MachineContext> {
  try {
    const snapshot = await new WindowsSnapshotCollector().collect();
    const game = snapshot.games.find((candidate) => candidate.config !== null);
    return {
      config: game === undefined ? null : configFrom(game.configPath, game.config),
      displayHz: highestRefresh(snapshot.displays),
    };
  } catch {
    // Без этих сведений рекомендации просто будут осторожнее.
    return UNKNOWN_MACHINE;
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
