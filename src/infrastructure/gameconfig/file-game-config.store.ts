import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type {
  ConfigWriteResult,
  GameConfigStore,
  StoredConfig,
} from '../../application/ports/game-config.port.ts';
import { runJsonProducingProcess } from '../process/json-process.runner.ts';
import { WindowsSnapshotCollector } from '../windows/windows-snapshot.collector.ts';

/**
 * Конфиг игры на диске.
 *
 * Здесь приложение впервые что-то **пишет**, и потому правило одно: ни одна
 * операция не уничтожает прежний файл. Перед записью и перед удалением рядом
 * появляется копия с отметкой времени. Конфиг человек собирает месяцами, а
 * нажать «Удалить» можно случайно и один раз.
 *
 * Копия лежит рядом с самим конфигом, а не в папке приложения: если чинить
 * придётся руками и без нас, искать её будут именно там.
 */
export class FileGameConfigStore implements GameConfigStore {
  /** Путь ищется через тот же снимок, что и аудит, и не меняется за запуск. */
  #path: Promise<string | null> | null = null;

  async read(): Promise<StoredConfig | null> {
    const path = await this.#configPath();
    if (path === null) return null;
    return { path, text: await readTextIfExists(path) };
  }

  async write(text: string): Promise<ConfigWriteResult> {
    const path = await this.#require();
    const backupPath = await backup(path);

    // Каталог cfg может не существовать вовсе: конфиг создаёт игрок, а не игра.
    await mkdir(dirname(path), { recursive: true });
    // UTF-8 без метки порядка байтов: движок читает конфиг как обычный текст,
    // а BOM пришёл бы первой «строкой» и в лучшем случае был бы пропущен.
    // Переводы строк остаются те, что в тексте: правка не должна переписывать
    // файл целиком ради одной цифры.
    await writeFile(path, text, 'utf8');

    return { path, backupPath };
  }

  async remove(): Promise<ConfigWriteResult> {
    const path = await this.#require();
    const backupPath = await backup(path);
    await rm(path, { force: true });
    return { path, backupPath };
  }

  async copyToDesktop(): Promise<string> {
    const path = await this.#require();
    const text = await readTextIfExists(path);
    if (text === null) {
      throw new Error(`Копировать нечего: ${path} не существует.`);
    }

    const target = join(await desktopDirectory(), `autoexec-${stamp()}.cfg`);
    await writeFile(target, text, 'utf8');
    return target;
  }

  async #require(): Promise<string> {
    const path = await this.#configPath();
    if (path === null) {
      throw new Error('Игра не найдена — непонятно, куда класть конфиг.');
    }
    return path;
  }

  #configPath(): Promise<string | null> {
    this.#path ??= resolveConfigPath();
    return this.#path;
  }
}

async function resolveConfigPath(): Promise<string | null> {
  try {
    const snapshot = await new WindowsSnapshotCollector().collect();
    return snapshot.games.find((game) => game.configPath !== null)?.configPath ?? null;
  } catch {
    return null;
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    // Файла нет — это норма: autoexec создаёт сам игрок.
    return null;
  }
}

/** Копия прежней версии рядом с оригиналом. `null` — копировать было нечего. */
async function backup(path: string): Promise<string | null> {
  const target = join(dirname(path), `${basename(path)}.${stamp()}.bak`);
  try {
    // Расширение .bak, а не .cfg: движок выполняет только .cfg, и лишний файл
    // рядом не должен однажды примениться сам.
    await copyFile(path, target);
    return target;
  } catch {
    return null;
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Рабочий стол пользователя.
 *
 * Не `%USERPROFILE%\Desktop`: при включённом OneDrive настоящий рабочий стол
 * лежит внутри его папки, а старый каталог остаётся на месте и выглядит
 * рабочим. Файл, положенный туда, человек просто не увидит — а решит, что
 * кнопка не работает.
 */
async function desktopDirectory(): Promise<string> {
  try {
    const value = await runJsonProducingProcess(
      'powershell.exe',
      (outputPath) => [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Environment]::GetFolderPath('Desktop') | ConvertTo-Json | ` +
          `Set-Content -LiteralPath ${psQuote(outputPath)} -Encoding UTF8`,
      ],
      { label: 'путь к рабочему столу', timeoutMs: 15_000 },
    );
    if (typeof value === 'string' && value.trim() !== '') return value;
  } catch {
    // Ниже — запасной вариант; без рабочего стола отказывать в копии незачем.
  }
  return join(homedir(), 'Desktop');
}

/** Строковый литерал PowerShell: обратная косая там не экранирует, а кавычка — удваивается. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
