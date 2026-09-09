import type { ReplayFile } from '../../domain/gameconfig/benchmark-plan.ts';

/**
 * Запуск игры с заданным повтором.
 *
 * Порт узкий намеренно. Всё, что приложению нужно от чужой программы, — узнать,
 * не запущена ли она уже, положить рядом с ней файл команд и попросить Steam
 * её открыть. Ни управления окном, ни ввода, ни чтения памяти: реализации
 * просто не через что это сделать.
 */

export interface GameLaunchTargets {
  /** Готовы ли мы запускать: найдены Steam и папка настроек игры. */
  readonly ready: boolean;
  /** Куда ляжет файл команд. `null` — игру найти не удалось. */
  readonly configPath: string | null;
  /** Почему запустить нельзя. Пусто, когда всё на месте. */
  readonly obstacles: readonly string[];
  readonly replays: readonly ReplayFile[];
}

export interface GameLauncher {
  /** Что мы вообще можем запустить на этой машине. */
  targets(): Promise<GameLaunchTargets>;
  /** Идёт ли игра прямо сейчас. */
  isGameRunning(): Promise<boolean>;
  /**
   * Кладёт файл команд и просит Steam открыть игру.
   *
   * Возвращает путь к файлу — человеку полезно знать, что именно мы записали и
   * куда, а нам полезно, чтобы это можно было проверить глазами.
   */
  launch(configLines: readonly string[], launchArgs: readonly string[]): Promise<string>;
}
