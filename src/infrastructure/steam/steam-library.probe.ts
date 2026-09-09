import { readdir, readFile, stat } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { GameProfile, Maybe, ReplayFile } from '../../domain/snapshot/system-snapshot.ts';
import { parseVdf, vdfObject, vdfString, type VdfObject } from './vdf.parser.ts';

/**
 * Игры, про которые инструмент что-то знает, и путь к исполняемому файлу
 * относительно папки установки.
 */
const KNOWN_GAMES: readonly {
  appId: string;
  relativeExecutable: string;
  /** Где игра держит autoexec.cfg относительно папки установки. */
  relativeConfig: string;
  /** Где лежат повторы матчей. */
  relativeReplays: string;
}[] = [
  {
    appId: '570',
    relativeExecutable: join('game', 'bin', 'win64', 'dota2.exe'),
    relativeConfig: join('game', 'dota', 'cfg', 'autoexec.cfg'),
    relativeReplays: join('game', 'dota', 'replays'),
  },
];

export interface SteamProbeResult {
  readonly games: readonly GameProfile[];
  readonly errors: readonly string[];
}

/**
 * Находит установленные игры и их параметры запуска.
 *
 * Всё, что не нашлось, возвращается как `null`, а причина — в `errors`:
 * отсутствие Steam не должно выглядеть как отсутствие проблем.
 */
export async function probeSteamLibraries(
  steamPath: Maybe<string>,
): Promise<SteamProbeResult> {
  if (steamPath === null) {
    return { games: [], errors: ['Steam не найден в реестре — игры не проверялись.'] };
  }

  const errors: string[] = [];
  const libraries = await readLibraryPaths(steamPath, errors);
  const launchOptions = await readLaunchOptions(steamPath, errors);

  const games: GameProfile[] = [];
  for (const known of KNOWN_GAMES) {
    const found = await findInstalledGame(libraries, known, errors);
    if (found === null) continue;
    games.push({
      ...found,
      launchOptions: launchOptions.get(known.appId) ?? null,
    });
  }

  return { games, errors };
}

// --- библиотеки -------------------------------------------------------------

async function readLibraryPaths(
  steamPath: string,
  errors: string[],
): Promise<readonly string[]> {
  const manifest = join(steamPath, 'steamapps', 'libraryfolders.vdf');
  const parsed = await readVdf(manifest, errors);
  if (parsed === null) return [steamPath];

  const root = vdfObject(parsed, 'libraryfolders') ?? parsed;
  const paths = new Set<string>([steamPath]);
  for (const key of Object.keys(root)) {
    const path = vdfString(root, key, 'path');
    if (path !== null) paths.add(path);
  }
  return [...paths];
}

async function findInstalledGame(
  libraries: readonly string[],
  known: {
    appId: string;
    relativeExecutable: string;
    relativeConfig: string;
    relativeReplays: string;
  },
  errors: string[],
): Promise<Omit<GameProfile, 'launchOptions'> | null> {
  for (const library of libraries) {
    const manifestPath = join(
      library,
      'steamapps',
      `appmanifest_${known.appId}.acf`,
    );
    const parsed = await readVdf(manifestPath, errors, { quiet: true });
    if (parsed === null) continue;

    const state = vdfObject(parsed, 'AppState') ?? parsed;
    const installDir = vdfString(state, 'installdir');
    const name = vdfString(state, 'name') ?? `Steam app ${known.appId}`;
    if (installDir === null) {
      errors.push(`В ${manifestPath} нет installdir.`);
      return {
        appId: known.appId,
        name,
        installDir: null,
        executablePath: null,
        configPath: null,
        config: null,
        replays: [],
      };
    }

    const installRoot = join(library, 'steamapps', 'common', installDir);
    // Конфиг читаем целиком: снимок должен быть самодостаточным, чтобы разобрать
    // чужую машину по присланному файлу.
    const configPath = join(installRoot, known.relativeConfig);
    const config = await readTextIfExists(configPath);
    // Путь отдаём и тогда, когда файла нет: это место, куда игра смотрит, а
    // значит и то место, где конфиг можно создать. Без него редактор конфига
    // не знал бы, куда писать, и отсутствие файла превращалось бы в тупик.
    const replays = await listReplays(join(installRoot, known.relativeReplays));

    const executablePath = join(
      library,
      'steamapps',
      'common',
      installDir,
      known.relativeExecutable,
    );
    const exists = await fileExists(executablePath);
    if (!exists) {
      errors.push(`Игра ${name} установлена, но ${executablePath} не найден.`);
    }

    return {
      appId: known.appId,
      name,
      installDir,
      executablePath: exists ? executablePath : null,
      configPath,
      config,
      replays,
    };
  }
  return null;
}

// --- параметры запуска ------------------------------------------------------

/**
 * Читает LaunchOptions из профилей всех локальных пользователей Steam.
 *
 * Профилей на машине бывает несколько; берём первый, где параметры вообще
 * заданы, — иначе пустая строка «свежего» аккаунта затрёт реальные настройки.
 */
async function readLaunchOptions(
  steamPath: string,
  errors: string[],
): Promise<Map<string, string>> {
  const options = new Map<string, string>();
  const userdata = join(steamPath, 'userdata');

  let profiles: string[];
  try {
    profiles = await readdir(userdata);
  } catch {
    errors.push('Папка userdata Steam недоступна — параметры запуска не проверены.');
    return options;
  }

  for (const profile of profiles) {
    const configPath = join(userdata, profile, 'config', 'localconfig.vdf');
    const parsed = await readVdf(configPath, errors, { quiet: true });
    if (parsed === null) continue;

    const apps = findAppsSection(parsed);
    if (apps === null) continue;

    for (const known of KNOWN_GAMES) {
      if (options.has(known.appId)) continue;
      const launch = vdfString(apps, known.appId, 'LaunchOptions');
      if (launch !== null && launch.trim() !== '') {
        options.set(known.appId, launch);
      }
    }
  }

  return options;
}

/** Путь до раздела с играми в localconfig.vdf исторически менялся. */
function findAppsSection(root: VdfObject): VdfObject | null {
  return (
    vdfObject(root, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps') ??
    vdfObject(root, 'UserLocalConfigStore', 'Software', 'valve', 'steam', 'apps')
  );
}

// --- файловые мелочи --------------------------------------------------------

async function readVdf(
  path: string,
  errors: string[],
  options: { quiet?: boolean } = {},
): Promise<VdfObject | null> {
  try {
    return parseVdf(await readFile(path, 'utf8'));
  } catch (error) {
    if (options.quiet !== true) {
      errors.push(`Не прочитан ${path}: ${describe(error)}`);
    }
    return null;
  }
}

/** Повторы матчей: по ним и делается повторяемый замер. */
async function listReplays(directory: string): Promise<ReplayFile[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const replays: ReplayFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.dem')) continue;
      const info = await stat(join(directory, entry.name));
      replays.push({ name: entry.name, sizeBytes: info.size });
    }
    return replays.sort((left, right) => right.sizeBytes - left.sizeBytes);
  } catch {
    return [];
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
