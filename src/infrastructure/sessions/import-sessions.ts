import { mkdir, readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export interface SessionImportResult {
  imported: number;
  skipped: number;
  rejected: number;
  errors: string[];
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Копирование без удаления источника. Повторный импорт идемпотентен. */
export async function importSessions(
  source: string,
  destination: string,
): Promise<SessionImportResult> {
  const result: SessionImportResult = { imported: 0, skipped: 0, rejected: 0, errors: [] };
  if (resolve(source).toLowerCase() === resolve(destination).toLowerCase()) return result;
  let entries;
  try {
    if ((await lstat(source)).isSymbolicLink())
      throw new Error('Папка записей не должна быть ссылкой.');
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }
  await mkdir(destination, { recursive: true });
  if ((await lstat(destination)).isSymbolicLink())
    throw new Error('Общая папка не должна быть ссылкой.');
  const receipts = join(destination, '.imported');
  await mkdir(receipts, { recursive: true });
  if ((await lstat(receipts)).isSymbolicLink())
    throw new Error('Каталог учёта импорта не должен быть ссылкой.');
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith('.json') ||
      entry.name.startsWith('.') ||
      entry.name === 'hypotheses.json'
    )
      continue;
    try {
      const path = join(source, entry.name);
      const raw = await readFile(path);
      const hash = createHash('sha256').update(raw).digest('hex');
      const receipt = join(receipts, hash);
      try {
        await lstat(receipt);
        result.skipped++;
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const data: unknown = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
      if (!object(data) || !object(data['summary']))
        throw new Error('Не является записью Кадроскопа.');
      const record = object(data['record']) ? data['record'] : null;
      const capture =
        record?.['capture'] ?? (object(data['result']) ? data['result']['capture'] : null);
      const id = record?.['id'] ?? data['summary']['id'];
      if (
        typeof id !== 'string' ||
        !id ||
        /[/\\:*?"<>|]|\.\./.test(id) ||
        !object(capture) ||
        !Array.isArray(capture['frames'])
      )
        throw new Error('Неверный формат записи.');
      let target = join(destination, `${id}.json`);
      let contents = raw;
      try {
        const existing = await readFile(target);
        if (existing.equals(raw)) {
          await writeFile(receipt, id, { flag: 'wx' }).catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          });
          result.skipped++;
          continue;
        }
        const importedId = `${id}-import-${hash.slice(0, 16)}`;
        target = join(destination, `${importedId}.json`);
        if (record) record['id'] = importedId;
        data['summary']['id'] = importedId;
        contents = Buffer.from(JSON.stringify(data));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await writeFile(target, contents, { flag: 'wx' });
        result.imported++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await readFile(target)).equals(contents))
          throw new Error('Имя занято другой записью; повторите импорт.', { cause: error });
        result.skipped++;
      }
      await writeFile(receipt, target, { flag: 'wx' }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
    } catch (error) {
      result.rejected++;
      result.errors.push(
        `${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
