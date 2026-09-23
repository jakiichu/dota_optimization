import { listBackups, readBackup, restoreBackup, validateBackupId } from './settings-backups.ts';
import { accountRoot, listSettings } from './settings-files.ts';
import { transferSettings } from './settings-transfer.ts';
import { ensureSettingsAppsClosed } from '../windows/settings-transfer.guard.ts';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AccountControlsStore,
  SettingsTransferMode,
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
  readonly #ensureClosed: () => Promise<void>;
  constructor(steamPath?: string | null, ensureClosed = ensureSettingsAppsClosed) {
    this.#ensureClosed = ensureClosed;
    this.#fixedSteamPath = steamPath;
  }

  async list(): Promise<readonly SteamControlProfile[]> {
    const steamPath = await this.#steamPath();
    if (steamPath === null) return [];
    return this.#profiles(steamPath);
  }

  #transferring = false;
  async transfer(
    sourceId: string,
    targetId: string,
    mode: SettingsTransferMode = 'controls',
  ): Promise<ControlTransferResult> {
    if (this.#transferring) throw new Error('Дождитесь завершения текущего переноса.');
    if (!/^\d+$/.test(sourceId) || !/^\d+$/.test(targetId) || sourceId === targetId)
      throw new Error('Выберите разные локальные аккаунты Steam.');
    if (mode !== 'controls' && mode !== 'all') throw new Error('Неизвестный режим переноса.');
    this.#transferring = true;
    try {
      await this.#ensureClosed();
      return await this.#transfer(sourceId, targetId, mode);
    } finally {
      this.#transferring = false;
    }
  }

  async #transfer(
    sourceId: string,
    targetId: string,
    mode: SettingsTransferMode,
  ): Promise<ControlTransferResult> {
    const steamPath = await this.#steamPath();
    if (steamPath === null) throw new Error('Steam не найден.');
    const profiles = await this.#profiles(steamPath);
    const source = profiles.find((profile) => profile.id === sourceId);
    const target = profiles.find((profile) => profile.id === targetId);
    if (source === undefined || target === undefined) {
      throw new Error('Один из выбранных локальных аккаунтов Steam больше не найден.');
    }
    const sourceRoot = await accountRoot(steamPath, sourceId);
    const targetRoot = await accountRoot(steamPath, targetId);
    const files = (await listSettings(sourceRoot)).filter(
      (file) => mode === 'all' || file.path.toLowerCase() === 'remote/cfg/dotakeys_personal.lst',
    );
    if (!files.length)
      throw new Error(
        mode === 'controls'
          ? 'У источника нет сохранённой раскладки Dota.'
          : 'У источника нет доступных настроек Dota.',
      );
    await this.#ensureClosed();
    const result = await transferSettings(
      sourceRoot,
      targetRoot,
      files.map((file) => file.path),
      { sourceLabel: source.label, kind: 'transfer' },
    );

    const refreshed = await this.#profiles(steamPath);
    return {
      source,
      target: refreshed.find((profile) => profile.id === targetId) ?? target,
      ...result,
    };
  }

  async backups() {
    const steamPath = await this.#steamPath();
    if (steamPath === null) return [];
    const entries = [];
    for (const profile of await this.#profiles(steamPath)) {
      entries.push(
        ...(await listBackups(await accountRoot(steamPath, profile.id), profile.id, profile.label)),
      );
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async restore(targetId: string, backupId: string) {
    if (this.#transferring) throw new Error('Дождитесь завершения текущей операции.');
    validateBackupId(backupId);
    this.#transferring = true;
    try {
      await this.#ensureClosed();
      const steamPath = await this.#steamPath();
      if (steamPath === null) throw new Error('Steam не найден.');
      const target = (await this.#profiles(steamPath)).find((profile) => profile.id === targetId);
      if (!target) throw new Error('Аккаунт-получатель не найден.');
      const root = await accountRoot(steamPath, targetId);
      const backup = await readBackup(root, backupId, targetId, target.label);
      await this.#ensureClosed();
      return await restoreBackup(root, backup);
    } finally {
      this.#transferring = false;
    }
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
      const dotaRoot = await accountRoot(steamPath, entry.name);
      if (!(await isDirectory(dotaRoot))) continue;
      const info = await fileInfo(controlsPath(steamPath, entry.name));
      const account = names.get(entry.name);
      profiles.push({
        settingsFiles: await listSettings(dotaRoot),
        id: entry.name,
        label: account?.label ?? `Steam ${masked(entry.name)}`,
        mostRecent: account?.mostRecent ?? false,
        hasControls: info !== null,
        sizeBytes: info?.size ?? null,
        modifiedAt: info?.modifiedAt ?? null,
      });
    }
    return profiles.sort(
      (left, right) =>
        Number(right.mostRecent) - Number(left.mostRecent) ||
        left.label.localeCompare(right.label, 'ru'),
    );
  }

  #steamPath(): Promise<string | null> {
    if (this.#fixedSteamPath !== undefined) return Promise.resolve(this.#fixedSteamPath);
    this.#resolvedSteamPath ??= new WindowsSnapshotCollector()
      .collect()
      .then((snapshot) => snapshot.steamPath)
      .catch(() => null);
    return this.#resolvedSteamPath;
  }
}

function controlsPath(steamPath: string, accountId: string): string {
  return join(steamPath, 'userdata', accountId, DOTA_APP_ID, 'remote', 'cfg', CONTROLS_FILE);
}

async function accountNames(
  steamPath: string,
): Promise<Map<string, { label: string; mostRecent: boolean }>> {
  try {
    const parsed = parseVdf(await readFile(join(steamPath, 'config', 'loginusers.vdf'), 'utf8'));
    const users = vdfObject(parsed, 'users') ?? parsed;
    const result = new Map<string, { label: string; mostRecent: boolean }>();
    for (const [steamId, raw] of Object.entries(users)) {
      if (typeof raw !== 'object' || !/^\d+$/.test(steamId)) continue;
      const accountId = toAccountId(steamId);
      if (accountId === null) continue;
      const persona =
        vdfString(raw as VdfObject, 'PersonaName') ??
        vdfString(raw as VdfObject, 'AccountName') ??
        `Steam ${masked(accountId)}`;
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
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
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
