import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSessions } from '../../src/infrastructure/sessions/import-sessions.ts';
import { sharedSessionsRoot } from '../../src/infrastructure/paths/user-data.ts';

describe('общая история', () => {
  it('не зависит от версии и уважает явную настройку каталога', () => {
    expect(sharedSessionsRoot({ APPDATA: 'C:/profile' })).toBe(
      join('C:/profile', 'Кадроскоп', 'sessions'),
    );
    expect(sharedSessionsRoot({ KADROSKOP_SESSIONS: 'C:/custom' }).replaceAll('\\', '/')).toBe(
      'C:/custom',
    );
  });
  it('копирует обе версии формата, сохраняет конфликты и не дублирует повторный импорт', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kadroskop-import-'));
    const source = join(root, 'old');
    const target = join(root, 'shared');
    try {
      await mkdir(source);
      await mkdir(target);
      const stored = { record: { id: 'one', capture: { frames: [] } }, summary: { id: 'one' } };
      const raw = JSON.stringify(stored);
      await writeFile(join(source, 'one.json'), raw);
      await writeFile(join(target, 'one.json'), 'existing contents');
      await writeFile(
        join(source, 'two.json'),
        JSON.stringify({ summary: { id: 'two' }, result: { capture: { frames: [] } } }),
      );
      await writeFile(join(source, 'bad.json'), '{}');
      const first = await importSessions(source, target);
      expect(first).toMatchObject({ imported: 2, rejected: 1 });
      expect(await readFile(join(target, 'one.json'), 'utf8')).toBe('existing contents');
      expect(await readFile(join(source, 'one.json'), 'utf8')).toBe(raw);
      const conflict = (await readdir(target)).find((name) => name.startsWith('one-import-'))!;
      const saved = JSON.parse(await readFile(join(target, conflict), 'utf8'));
      expect(saved.record.id).toBe(conflict.slice(0, -5));
      expect(saved.summary.id).toBe(saved.record.id);
      expect(await importSessions(source, target)).toMatchObject({
        imported: 0,
        skipped: 2,
        rejected: 1,
      });
      expect(await importSessions(target, target)).toMatchObject({ imported: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('отклоняет идентификаторы с выходом за пределы папки', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kadroskop-import-'));
    try {
      const source = join(root, 'old');
      await mkdir(source);
      await writeFile(
        join(source, 'evil.json'),
        JSON.stringify({ summary: { id: '../escape' }, result: { capture: { frames: [] } } }),
      );
      expect(await importSessions(source, join(root, 'new'))).toMatchObject({
        imported: 0,
        rejected: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
