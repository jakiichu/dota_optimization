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

    const profiles = await new SteamAccountControlsStore(root, async () => {}).list();

    expect(profiles.map((item) => item.label)).toEqual(['Основной', 'Второй']);
    expect(profiles.map((item) => item.hasControls)).toEqual([true, false]);
  });

  it('копирует раскладку и сохраняет прежнюю версию получателя', async () => {
    const root = await fixture();
    const sourcePath = await profile(root, '101', 'source controls');
    const targetPath = await profile(root, '202', 'target controls');
    await loginUsers(root, [['101', 'Источник', true], ['202', 'Получатель', false]]);

    const result = await new SteamAccountControlsStore(root, async () => {}).transfer('101', '202');

    expect(await readFile(targetPath, 'utf8')).toBe(await readFile(sourcePath, 'utf8'));
    expect(result.transferredBytes).toBe(Buffer.byteLength('source controls'));
    expect(result.backupPath).not.toBeNull();
    expect(await readFile(join(result.backupPath!, 'remote/cfg/dotakeys_personal.lst'), 'utf8')).toBe('target controls');
  });

  it('создаёт раскладку и записывает в манифест отсутствие прежнего файла', async () => {
    const root = await fixture();
    await profile(root, '101', 'source controls');
    const targetPath = await profile(root, '202', null);

    const result = await new SteamAccountControlsStore(root, async () => {}).transfer('101', '202');

    expect(await readFile(targetPath, 'utf8')).toBe('source controls');
    const manifest = JSON.parse(await readFile(join(result.backupPath!, 'manifest.json'), 'utf8'));
    expect(manifest.files[0].existed).toBe(false);
  });

  it('переносит звук, видео, новые бинды и сетки, сохраняя служебные файлы получателя', async () => {
    const root = await fixture();
    await profile(root, '101', 'source'); await profile(root, '202', 'target');
    const source = join(root, 'userdata/101/570'); const target = join(root, 'userdata/202/570');
    const settings = ['local/cfg/machine_convars.vcfg', 'local/cfg/video.txt', 'local/cfg/user_convars_0_slot0.vcfg', 'remote/user_convars.vcfg', 'remote/cfg/hero_grid_config.json', 'remote/scripts/control_groups.txt', 'remote/guides/hero.build'];
    for (const name of [...settings, 'remotecache.vdf', 'remote/cfg/stats.dat', 'local/cfg/trustedlaunch.cfg', 'local/cfg/user_convars_0_slot0.vcfg_lastclouded']) {
      const { dirname } = await import('node:path');
      await mkdir(dirname(join(source, name)), { recursive: true });
      await mkdir(dirname(join(target, name)), { recursive: true });
      await writeFile(join(source, name), 'source data'); await writeFile(join(target, name), 'target data');
    }
    const store = new SteamAccountControlsStore(root, async () => {});
    const profiles = await store.list();
    expect(profiles[0]?.settingsFiles?.length).toBe(8);
    const result = await store.transfer('101', '202', 'all');
    expect(result.transferredFiles).toHaveLength(8);
    for (const name of settings) {
      expect(await readFile(join(target, name), 'utf8')).toBe('source data');
      expect(await readFile(join(result.backupPath!, name), 'utf8')).toBe('target data');
    }
    for (const name of ['remotecache.vdf', 'remote/cfg/stats.dat', 'local/cfg/trustedlaunch.cfg', 'local/cfg/user_convars_0_slot0.vcfg_lastclouded']) {
      expect(await readFile(join(target, name), 'utf8')).toBe('target data');
    }
  });

  it('переносит общие настройки даже без старого файла раскладки', async () => {
    const root = await fixture(); await profile(root, '101', null); await profile(root, '202', null);
    await writeFile(join(root, 'userdata/101/570/remote/user_convars.vcfg'), 'sound settings');
    const result = await new SteamAccountControlsStore(root, async () => {}).transfer('101', '202', 'all');
    expect(result.transferredFiles).toEqual(['remote/user_convars.vcfg']);
  });

  it('при запущенной игре не меняет файлы', async () => {
    const root = await fixture(); await profile(root, '101', 'source'); const target = await profile(root, '202', 'target');
    const store = new SteamAccountControlsStore(root, async () => { throw new Error('Закройте Dota'); });
    await expect(store.transfer('101', '202', 'all')).rejects.toThrow('Закройте Dota');
    expect(await readFile(target, 'utf8')).toBe('target');
  });

  it('не переносит отсутствующую раскладку', async () => {
    const root = await fixture();
    await profile(root, '101', null);
    await profile(root, '202', 'target');
    const store = new SteamAccountControlsStore(root, async () => {});

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
