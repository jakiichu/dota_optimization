import { mkdir, readFile, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkedPath, isSettingsFile } from './settings-files.ts';

async function atomicWrite(path: string, data: Buffer): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, data, { flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

/** Сначала читаем и сохраняем весь набор, затем заменяем; при ошибке откатываем. */
export async function transferSettings(sourceRoot: string, targetRoot: string, paths: readonly string[]) {
  const files: { path: string; target: string; contents: Buffer; before: Buffer | null }[] = [];
  for (const path of paths) {
    if (!isSettingsFile(path)) throw new Error('Файл не относится к настройкам Dota.');
    const source = await checkedPath(sourceRoot, path);
    const target = await checkedPath(targetRoot, path);
    if (!(await lstat(source)).isFile()) throw new Error(`Ожидался файл: ${path}`);
    const contents = await readFile(source);
    let before: Buffer | null = null;
    try {
      if (!(await lstat(target)).isFile()) throw new Error(`У получателя вместо файла папка: ${path}`);
      before = await readFile(target);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    files.push({ path, target, contents, before });
  }
  const backupPath = await checkedPath(targetRoot, `.kadroskop-backups/${Date.now()}-${randomUUID()}`);
  await mkdir(backupPath, { recursive: true });
  for (const file of files) {
    if (file.before === null) continue;
    const saved = join(backupPath, file.path);
    await mkdir(dirname(saved), { recursive: true });
    await writeFile(saved, file.before, { flag: 'wx' });
  }
  await writeFile(join(backupPath, 'manifest.json'), JSON.stringify({
    createdAt: new Date().toISOString(), files: files.map(f => ({ path: f.path, existed: f.before !== null })),
    restore: 'При закрытых Steam и Dota скопируйте сохранённые файлы в папку 570, сохранив структуру. Файлы с existed=false были созданы переносом.',
  }, null, 2), { flag: 'wx' });
  const applied: typeof files = [];
  try {
    for (const file of files) {
      await checkedPath(targetRoot, file.path);
      await mkdir(dirname(file.target), { recursive: true });
      await atomicWrite(file.target, file.contents);
      applied.push(file);
    }
  } catch (error) {
    const errors: unknown[] = [];
    for (const file of applied.reverse()) {
      try {
        await checkedPath(targetRoot, file.path);
        if (file.before === null) await rm(file.target, { force: true });
        else await atomicWrite(file.target, file.before);
      } catch (failure) { errors.push(failure); }
    }
    throw new Error(`Перенос не завершён. ${errors.length ? 'Автоматический откат не завершён.' : 'Изменения отменены.'} Резервная копия: ${backupPath}`, { cause: error });
  }
  return { backupPath, transferredBytes: files.reduce((sum, f) => sum + f.contents.length, 0), transferredFiles: paths };
}
