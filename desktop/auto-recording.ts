import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const execute = promisify(execFile);

/** Один запуск на один процесс игры: ручная остановка и ошибка не запускают цикл UAC. */
export class AutoRecordingGate {
  private seen = new Set<string>();
  consider(pids: readonly string[], enabled: boolean, busy: boolean): boolean {
    this.seen = new Set([...this.seen].filter((pid) => pids.includes(pid)));
    if (!enabled) return false;
    const fresh = pids.some((pid) => !this.seen.has(pid));
    for (const pid of pids) this.seen.add(pid);
    return fresh && !busy;
  }
}
export async function dotaProcesses(): Promise<string[]> {
  const { stdout } = await execute(
    'tasklist.exe',
    ['/FI', 'IMAGENAME eq dota2.exe', '/FO', 'CSV', '/NH'],
    { windowsHide: true, timeout: 5000 },
  );
  return [...stdout.matchAll(/^"dota2\.exe","(\d+)"/gim)].map((match) => match[1]!);
}

/** Удаляются только явно зарегистрированные автозаписи; новейшая сохраняется. */
export async function retainAutoHistory(
  directory: string,
  ledger: string,
  newId: string | null,
  limit = 20,
  maxBytes = 2 * 1024 ** 3,
): Promise<boolean> {
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(await readFile(ledger, 'utf8'));
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string'))
      throw new Error('Повреждён список автозаписей.');
    ids = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (newId) ids.push(newId);
  ids = [...new Set(ids)];
  const files: { id: string; path: string; size: number }[] = [];
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error('Каталог записей не должен быть ссылкой.');
  for (const id of ids) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Неверное имя автозаписи.');
    const path = resolve(directory, `${id}.json`);
    if (dirname(path) !== resolve(directory)) throw new Error('Недопустимый путь записи.');
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Автозапись не является обычным файлом.');
      files.push({ id, path, size: info.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  // Сначала сохраняем учёт новой записи, чтобы сбой очистки не потерял её из истории.
  const save = async () => {
    const temp = `${ledger}.tmp`;
    await writeFile(temp, JSON.stringify(files.map((file) => file.id)));
    await rename(temp, ledger);
  };
  await save();
  let total = files.reduce((sum, file) => sum + file.size, 0);
  while (files.length > 1 && (files.length > limit || total > maxBytes)) {
    const oldest = files[0]!;
    await unlink(oldest.path);
    files.shift();
    total -= oldest.size;
    await save();
  }
  return total > maxBytes;
}
