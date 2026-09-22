import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SteamAccountControlsStore } from '../../src/infrastructure/steam/account-controls.store.ts';

const roots: string[] = [];
const STEAM_ID_BASE = 76561197960265728n;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SteamAccountControlsStore', () => {
  it('показывает только локальные профили, где запускали Dota', async () => {
    const root = await fixture();
    await profile(root, '101', 'source');
    await profile(root, '202', null);
    await mkdir(join(root, 'userdata', '303'), { recursive: true });
    await loginUsers(root, [
      ['101', 'Основной', true],
      ['202', 'Второй', false],
      ['303', 'Без Dota', false],
    ]);

    const profiles = await new SteamAccountControlsStore(root).list();

    expect(profiles.map((item) => item.label)).toEqual(['Основной', 'Второй']);
    expect(profiles.map((item) => item.hasControls)).toEqual([true, false]);
  });

  it('копирует раскладку и сохраняет прежнюю версию получателя', async () => {
    const root = await fixture();
    const sourcePath = await profile(root, '101', 'source controls');
    const targetPath = await profile(root, '202', 'target controls');
    await loginUsers(root, [['101', 'Источник', true], ['202', 'Получатель', false]]);

    const result = await new SteamAccountControlsStore(root).transfer('101', '202');

    expect(await readFile(targetPath, 'utf8')).toBe(await readFile(sourcePath, 'utf8'));
    expect(result.transferredBytes).toBe(Buffer.byteLength('source controls'));
    expect(result.backupPath).not.toBeNull();
    expect(await readFile(result.backupPath!, 'utf8')).toBe('target controls');
  });

  it('создаёт раскладку получателю без файла и не выдумывает резервную копию', async () => {
    const root = await fixture();
    await profile(root, '101', 'source controls');
    const targetPath = await profile(root, '202', null);

    const result = await new SteamAccountControlsStore(root).transfer('101', '202');

    expect(await readFile(targetPath, 'utf8')).toBe('source controls');
    expect(result.backupPath).toBeNull();
  });

  it('не переносит отсутствующую раскладку', async () => {
    const root = await fixture();
    await profile(root, '101', null);
    await profile(root, '202', 'target');
    const store = new SteamAccountControlsStore(root);

    await expect(store.transfer('101', '202')).rejects.toThrow('нет сохранённой раскладки');
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kadroskop-controls-'));
  roots.push(root);
  return root;
}

async function profile(root: string, id: string, controls: string | null): Promise<string> {
  const directory = join(root, 'userdata', id, '570', 'remote', 'cfg');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'dotakeys_personal.lst');
  if (controls !== null) await writeFile(path, controls, 'utf8');
  return path;
}

async function loginUsers(
  root: string,
  users: readonly (readonly [string, string, boolean])[],
): Promise<void> {
  await mkdir(join(root, 'config'), { recursive: true });
  const body = users.map(([id, name, recent]) => `
    "${STEAM_ID_BASE + BigInt(id)}"
    {
      "AccountName" "account${id}"
      "PersonaName" "${name}"
      "MostRecent" "${recent ? '1' : '0'}"
    }`).join('');
  await writeFile(join(root, 'config', 'loginusers.vdf'), `"users" {${body}\n}`, 'utf8');
}
