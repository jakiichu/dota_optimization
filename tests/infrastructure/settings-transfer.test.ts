import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transferSettings } from '../../src/infrastructure/steam/settings-transfer.ts';
import { accountRoot, checkedPath } from '../../src/infrastructure/steam/settings-files.ts';
const failure = vi.hoisted(() => ({ target: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: async (from: string, to: string) => {
    if (to === failure.target) { failure.target = ''; throw new Error('Test write failure'); }
    return actual.rename(from, to);
  } };
});
const roots: string[] = [];
afterEach(async () => { failure.target = ''; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kadroskop-transfer-')); roots.push(root);
  const source = join(root, 'source'); const target = join(root, 'target');
  await mkdir(join(source, 'remote'), { recursive: true }); await mkdir(join(target, 'remote'), { recursive: true });
  return { root, source, target };
}
describe('целостность переноса', () => {
  it('откатывает заменённые и новые файлы при сбое в середине записи', async () => {
    const { source, target } = await fixture();
    const files = ['remote/user_keys.vcfg', 'remote/user_convars.vcfg'];
    for (const file of files) await writeFile(join(source, file), 'new');
    await writeFile(join(target, files[0]!), 'old');
    failure.target = join(target, files[1]!);
    await expect(transferSettings(source, target, files)).rejects.toThrow('Изменения отменены');
    expect(await readFile(join(target, files[0]!), 'utf8')).toBe('old');
    await rm(join(target, files[0]!));
    failure.target = join(target, files[1]!);
    await expect(transferSettings(source, target, files)).rejects.toThrow('Изменения отменены');
    await expect(readFile(join(target, files[0]!))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('не начинает запись при ошибке чтения следующего исходного файла', async () => {
    const { source, target } = await fixture();
    await writeFile(join(source, 'remote/user_keys.vcfg'), 'new');
    await writeFile(join(target, 'remote/user_keys.vcfg'), 'old');
    await expect(transferSettings(source, target, ['remote/user_keys.vcfg', 'remote/user_convars.vcfg'])).rejects.toThrow();
    expect(await readFile(join(target, 'remote/user_keys.vcfg'), 'utf8')).toBe('old');
  });
  it('не проходит через junction и не принимает выход из профиля', async () => {
    const { root, source, target } = await fixture();
    await expect(checkedPath(source, '../escape')).rejects.toThrow('Недопустимый');
    await symlink(target, join(source, 'local'), 'junction');
    await expect(checkedPath(source, 'local/cfg/video.txt')).rejects.toThrow('junction');
    await expect(accountRoot(root, '../101')).rejects.toThrow('неверно');
  });
});
