import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readVpkFile, readVpkIndex } from '../../src/infrastructure/steam/vpk.reader.ts';

/**
 * Проверка на выдуманном архиве, а не на файлах игры.
 *
 * Тест должен проходить на машине без Dota, а сам формат от этого не меняется:
 * ошибиться здесь можно только в арифметике смещений, и её видно и на трёх
 * файлах.
 */

const INLINE = 0x7fff;

interface FakeEntry {
  readonly path: string;
  readonly archiveIndex: number;
  readonly data: Buffer;
}

/** Собирает каталог VPK версии 2 из перечисленных файлов. */
function buildVpk(entries: readonly FakeEntry[]): {
  readonly dir: Buffer;
  readonly archives: ReadonlyMap<number, Buffer>;
} {
  const archives = new Map<number, Buffer>();
  const inlineData: Buffer[] = [];
  let inlineOffset = 0;

  const placed = entries.map((entry) => {
    if (entry.archiveIndex === INLINE) {
      const offset = inlineOffset;
      inlineData.push(entry.data);
      inlineOffset += entry.data.length;
      return { ...entry, offset };
    }
    const existing = archives.get(entry.archiveIndex) ?? Buffer.alloc(0);
    archives.set(entry.archiveIndex, Buffer.concat([existing, entry.data]));
    return { ...entry, offset: existing.length };
  });

  const parts: Buffer[] = [];
  const zero = Buffer.from([0]);
  const text = (value: string): Buffer => Buffer.concat([Buffer.from(value, 'utf8'), zero]);

  // Дерево: расширение → путь → имя. В тесте всё лежит в одной ветке.
  parts.push(text('txt'), text('resource/localization'));
  for (const entry of placed) {
    const name = entry.path.split('/').at(-1)?.replace(/\.txt$/, '') ?? '';
    parts.push(text(name));

    const record = Buffer.alloc(18);
    record.writeUInt32LE(0, 0); // контрольная сумма
    record.writeUInt16LE(0, 4); // без вшитого начала
    record.writeUInt16LE(entry.archiveIndex, 6);
    record.writeUInt32LE(entry.offset, 8);
    record.writeUInt32LE(entry.data.length, 12);
    record.writeUInt16LE(0xffff, 16);
    parts.push(record);
  }
  parts.push(zero, zero, zero); // конец имён, путей и расширений

  const tree = Buffer.concat(parts);
  const header = Buffer.alloc(28);
  header.writeUInt32LE(0x55aa1234, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(tree.length, 8);

  return { dir: Buffer.concat([header, tree, ...inlineData]), archives };
}

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'frameloss-vpk-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function write(entries: readonly FakeEntry[]): Promise<string> {
  const { dir, archives } = buildVpk(entries);
  const dirPath = join(workDir, 'pak01_dir.vpk');
  await writeFile(dirPath, dir);
  for (const [index, data] of archives) {
    await writeFile(join(workDir, `pak01_${String(index).padStart(3, '0')}.vpk`), data);
  }
  return dirPath;
}

describe('readVpkIndex', () => {
  it('перечисляет файлы полными путями', async () => {
    const dirPath = await write([
      { path: 'resource/localization/dota_russian.txt', archiveIndex: 4, data: Buffer.from('раз') },
      { path: 'resource/localization/dota_english.txt', archiveIndex: 4, data: Buffer.from('two') },
    ]);

    const index = await readVpkIndex(dirPath);

    expect([...index.entries.keys()]).toEqual([
      'resource/localization/dota_russian.txt',
      'resource/localization/dota_english.txt',
    ]);
  });

  it('отказывается от файла, который не VPK', async () => {
    const path = join(workDir, 'pak01_dir.vpk');
    await writeFile(path, 'просто текст');

    await expect(readVpkIndex(path)).rejects.toThrow('не похож на VPK');
  });
});

describe('readVpkFile', () => {
  it('достаёт файл из нумерованного архива', async () => {
    const dirPath = await write([
      { path: 'resource/localization/a.txt', archiveIndex: 7, data: Buffer.from('первый') },
      { path: 'resource/localization/b.txt', archiveIndex: 7, data: Buffer.from('второй') },
    ]);
    const index = await readVpkIndex(dirPath);
    const entry = index.entries.get('resource/localization/b.txt');

    const data = await readVpkFile(dirPath, index, entry!);

    expect(data.toString('utf8')).toBe('второй');
  });

  it('достаёт файл, вшитый в сам каталог', async () => {
    // Смещение у таких файлов считается от конца дерева, а не от начала файла.
    // Перепутав это, мы прочитали бы кусок собственного каталога.
    const dirPath = await write([
      { path: 'resource/localization/inline.txt', archiveIndex: INLINE, data: Buffer.from('внутри') },
    ]);
    const index = await readVpkIndex(dirPath);
    const entry = index.entries.get('resource/localization/inline.txt');

    const data = await readVpkFile(dirPath, index, entry!);

    expect(data.toString('utf8')).toBe('внутри');
  });
});
