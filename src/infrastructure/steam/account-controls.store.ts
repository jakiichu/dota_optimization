import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AccountControlsStore,
  ControlTransferResult,
  SteamControlProfile,
} from '../../application/ports/account-controls.port.ts';
import { WindowsSnapshotCollector } from '../windows/windows-snapshot.collector.ts';
import { parseVdf, vdfObject, vdfString, type VdfObject } from './vdf.parser.ts';

const DOTA_APP_ID = '570';
const CONTROLS_FILE = 'dotakeys_personal.lst';
const STEAM_ID_BASE = 76561197960265728n;

/** Файловое хранилище персональных раскладок Dota в Steam userdata. */
export class SteamAccountControlsStore implements AccountControlsStore {
  readonly #fixedSteamPath: string | null | undefined;
  #resolvedSteamPath: Promise<string | null> | null = null;

  /** Фиксированный путь нужен тестам; без аргумента путь берётся из снимка Windows. */
  constructor(steamPath?: string | null) {
    this.#fixedSteamPath = steamPath;
  }

  async list(): Promise<readonly SteamControlProfile[]> {
    const steamPath = await this.#steamPath();
    if (steamPath === null) return [];
    return this.#profiles(steamPath);
  }

  async transfer(sourceId: string, targetId: string): Promise<ControlTransferResult> {
    const steamPath = await this.#steamPath();
    if (steamPath === null) throw new Error('Steam не найден.');
    const profiles = await this.#profiles(steamPath);
    const source = profiles.find((profile) => profile.id === sourceId);
    const target = profiles.find((profile) => profile.id === targetId);
    if (source === undefined || target === undefined) {
      throw new Error('Один из выбранных локальных аккаунтов Steam больше не найден.');
    }
    if (!source.hasControls) {
      throw new Error(`У аккаунта «${source.label}» нет сохранённой раскладки Dota.`);
    }

    const sourcePath = controlsPath(steamPath, sourceId);
    const targetPath = controlsPath(steamPath, targetId);
    const contents = await readFile(sourcePath);
    await mkdir(join(steamPath, 'userdata', targetId, DOTA_APP_ID, 'remote', 'cfg'), {
      recursive: true,
    });

    const backupPath = target.hasControls
      ? `${targetPath}.${stamp()}.bak`
      : null;
    if (backupPath !== null) await copyFile(targetPath, backupPath);

    // Сначала полный временный файл, затем атомарная замена: авария не оставит
    // получателю половину VDF-раскладки.
    const temporary = `${targetPath}.kadroskop.tmp`;
    await writeFile(temporary, contents);
    await rm(targetPath, { force: true });
    await rename(temporary, targetPath);

    const refreshed = await this.#profiles(steamPath);
    return {
      source,
      target: refreshed.find((profile) => profile.id === targetId) ?? target,
      backupPath,
      transferredBytes: contents.byteLength,
    };
  }

  async #profiles(steamPath: string): Promise<SteamControlProfile[]> {
    const userdata = join(steamPath, 'userdata');
    const names = await accountNames(steamPath);
    let entries;
    try {
      entries = await readdir(userdata, { withFileTypes: true });
    } catch {
      return [];
    }

    const profiles: SteamControlProfile[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const dotaRoot = join(userdata, entry.name, DOTA_APP_ID);
      if (!(await isDirectory(dotaRoot))) continue;
      const info = await fileInfo(controlsPath(steamPath, entry.name));
      const account = names.get(entry.name);
      profiles.push({
        id: entry.name,
        label: account?.label ?? `Steam ${masked(entry.name)}`,
        mostRecent: account?.mostRecent ?? false,
        hasControls: info !== null,
        sizeBytes: info?.size ?? null,
        modifiedAt: info?.modifiedAt ?? null,
      });
    }
    return profiles.sort((left, right) =>
      Number(right.mostRecent) - Number(left.mostRecent) || left.label.localeCompare(right.label, 'ru'),
    );
  }

  #steamPath(): Promise<string | null> {
    if (this.#fixedSteamPath !== undefined) return Promise.resolve(this.#fixedSteamPath);
    this.#resolvedSteamPath ??= new WindowsSnapshotCollector().collect()
      .then((snapshot) => snapshot.steamPath)
      .catch(() => null);
    return this.#resolvedSteamPath;
  }
}

function controlsPath(steamPath: string, accountId: string): string {
  return join(steamPath, 'userdata', accountId, DOTA_APP_ID, 'remote', 'cfg', CONTROLS_FILE);
}

async function accountNames(steamPath: string): Promise<Map<string, { label: string; mostRecent: boolean }>> {
  try {
    const parsed = parseVdf(await readFile(join(steamPath, 'config', 'loginusers.vdf'), 'utf8'));
    const users = vdfObject(parsed, 'users') ?? parsed;
    const result = new Map<string, { label: string; mostRecent: boolean }>();
    for (const [steamId, raw] of Object.entries(users)) {
      if (typeof raw !== 'object' || !/^\d+$/.test(steamId)) continue;
      const accountId = toAccountId(steamId);
      if (accountId === null) continue;
      const persona = vdfString(raw as VdfObject, 'PersonaName')
        ?? vdfString(raw as VdfObject, 'AccountName')
        ?? `Steam ${masked(accountId)}`;
      result.set(accountId, {
        label: persona,
        mostRecent: vdfString(raw as VdfObject, 'MostRecent') === '1',
      });
    }
    return result;
  } catch {
    return new Map();
  }
}

function toAccountId(steamId: string): string | null {
  try {
    const value = BigInt(steamId) - STEAM_ID_BASE;
    return value >= 0n ? String(value) : null;
  } catch {
    return null;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

async function fileInfo(path: string): Promise<{ size: number; modifiedAt: string } | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { size: info.size, modifiedAt: info.mtime.toISOString() } : null;
  } catch {
    return null;
  }
}

function masked(id: string): string {
  return `••••${id.slice(-4)}`;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
