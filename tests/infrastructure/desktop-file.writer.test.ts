import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTextToDesktop } from '../../src/infrastructure/file/desktop-file.writer.ts';

describe('запись текстового файла на рабочий стол', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('пишет UTF-8 в каталог, который вернула Windows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kadroskop-desktop-'));
    directories.push(directory);
    const path = await writeTextToDesktop(
      'kadroskop-report',
      'html',
      '<!doctype html><title>Проверка</title>',
      async () => directory,
    );

    expect(basename(path)).toMatch(/^kadroskop-report-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.html$/);
    expect(await readFile(path, 'utf8')).toBe('<!doctype html><title>Проверка</title>');
  });

  it('не позволяет превратить имя в произвольный путь', async () => {
    await expect(
      writeTextToDesktop('../outside', 'html', 'x', async () => tmpdir()),
    ).rejects.toThrow('Недопустимое имя');
  });
});
