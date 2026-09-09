import { execFile, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type {
  GameLaunchTargets,
  GameLauncher,
} from '../../application/ports/game-launcher.port.ts';
import type { ReplayFile } from '../../domain/gameconfig/benchmark-plan.ts';
import { BENCHMARK_CONFIG_NAME } from '../../domain/gameconfig/replay-run.ts';
import { WindowsSnapshotCollector } from '../windows/windows-snapshot.collector.ts';

const execFileAsync = promisify(execFile);

const GAME_PROCESS = 'dota2.exe';
const STEAM_EXECUTABLE = 'steam.exe';

/** Сколько ждём ответа от tasklist: он локальный и быстрый. */
const PROCESS_CHECK_TIMEOUT_MS = 5000;

/**
 * Запуск Dota через Steam.
 *
 * Через `steam.exe -applaunch`, а не напрямую по пути к `dota2.exe`: игре нужен
 * запущенный Steam и его авторизация, и запуск мимо него кончается окном об
 * ошибке. Steam же передаёт наши параметры игре и добавляет к ним те, что
 * человек прописал у себя в свойствах, — трогать чужие настройки запуска мы не
 * станем.
 *
 * Файл команд кладётся рядом с autoexec под своим именем и перезаписывается
 * каждым прогоном. Это второй и последний файл игры, в который мы пишем.
 */
export class SteamGameLauncher implements GameLauncher {
  #found: Promise<Found> | null = null;

  async targets(): Promise<GameLaunchTargets> {
    const found = await this.#locate();
    const obstacles: string[] = [];

    if (found.steamExecutable === null) {
      obstacles.push('Steam не найден — запускать игру нечем.');
    }
    if (found.configDir === null) {
      obstacles.push('Папка настроек Dota не найдена — некуда положить команды прогона.');
    }
    if (found.replays.length === 0) {
      obstacles.push(
        'Повторов не нашлось. Скачайте любой матч в клиенте: без записанного ' +
          'матча повторять нечего.',
      );
    }

    return {
      ready: found.steamExecutable !== null && found.configDir !== null,
      configPath: found.configDir === null ? null : configPathIn(found.configDir),
      obstacles,
      replays: found.replays,
    };
  }

  /**
   * Идёт ли игра.
   *
   * Через `tasklist`, а не через перебор процессов: нам нужно знать только
   * «да или нет», и спрашивать об этом систему дешевле, чем читать список
   * целиком. Имя процесса — латиница, поэтому кодовая страница консоли здесь
   * ничего не испортит.
   */
  async isGameRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/FI', `IMAGENAME eq ${GAME_PROCESS}`, '/NH', '/FO', 'CSV'],
        { timeout: PROCESS_CHECK_TIMEOUT_MS, windowsHide: true },
      );
      return stdout.toLowerCase().includes(GAME_PROCESS);
    } catch {
      // Не смогли спросить — считаем, что не запущена: запуск в худшем случае
      // просто переключит на уже открытую игру, а отказ заблокировал бы работу.
      return false;
    }
  }

  async launch(
    configLines: readonly string[],
    launchArgs: readonly string[],
  ): Promise<string> {
    const found = await this.#locate();
    if (found.steamExecutable === null || found.configDir === null) {
      throw new Error('Запустить игру нечем: не найден Steam или папка её настроек.');
    }

    const configPath = configPathIn(found.configDir);
    // CRLF: файл открывают в блокноте, когда прогон повёл себя странно.
    await writeFile(configPath, `${configLines.join('\r\n')}\r\n`, 'utf8');

    // Отсоединяем: Steam живёт дольше нашего процесса, и держать его дескрипторы
    // значило бы не дать нам самим завершиться.
    spawn(found.steamExecutable, [...launchArgs], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    return configPath;
  }

  #locate(): Promise<Found> {
    this.#found ??= locate();
    return this.#found;
  }
}

interface Found {
  readonly steamExecutable: string | null;
  /** Папка cfg игры — там же лежит autoexec. */
  readonly configDir: string | null;
  readonly replays: readonly ReplayFile[];
}

function configPathIn(configDir: string): string {
  return join(configDir, `${BENCHMARK_CONFIG_NAME}.cfg`);
}

/**
 * Ищет Steam, папку настроек игры и повторы.
 *
 * Всё это уже есть в снимке системы, которым живёт аудит: заводить второй
 * поиск библиотек Steam ради одной кнопки незачем.
 */
async function locate(): Promise<Found> {
  try {
    const snapshot = await new WindowsSnapshotCollector().collect();
    const game = snapshot.games.find((candidate) => candidate.configPath !== null);
    const configPath = game?.configPath ?? null;

    return {
      steamExecutable:
        snapshot.steamPath === null ? null : join(snapshot.steamPath, STEAM_EXECUTABLE),
      configDir: configPath === null ? null : dirname(configPath),
      replays: game?.replays ?? [],
    };
  } catch {
    return { steamExecutable: null, configDir: null, replays: [] };
  }
}
