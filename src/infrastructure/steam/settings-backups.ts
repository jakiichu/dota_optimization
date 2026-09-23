import { readFile, readdir, lstat } from 'node:fs/promises';
import { checkedPath, isSettingsFile } from './settings-files.ts';
import { transferSettings } from './settings-transfer.ts';
import type { SettingsBackup } from '../../application/ports/account-controls.port.ts';

export function validateBackupId(id: string): void {
  if (!/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new Error('Неверный идентификатор резервной копии.');
}
export async function readBackup(
  root: string,
  id: string,
  targetId: string,
  targetLabel: string,
): Promise<SettingsBackup> {
  validateBackupId(id);
  const manifest = await checkedPath(root, `.kadroskop-backups/${id}/manifest.json`);
  if ((await lstat(manifest)).size > 1024 * 1024)
    throw new Error('Слишком большой манифест копии.');
  const data: unknown = JSON.parse(await readFile(manifest, 'utf8'));
  if (
    !isRecord(data) ||
    typeof data.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    !Array.isArray(data.files) ||
    !data.files.length ||
    data.files.length > 1000
  )
    throw new Error('Повреждён манифест копии.');
  const seen = new Set<string>();
  const files: { path: string; existed: boolean }[] = [];
  for (const file of data.files) {
    if (
      !isRecord(file) ||
      typeof file.path !== 'string' ||
      !isSettingsFile(file.path) ||
      typeof file.existed !== 'boolean' ||
      seen.has(file.path.toLowerCase())
    )
      throw new Error('Недопустимый файл в резервной копии.');
    seen.add(file.path.toLowerCase());
    files.push({ path: file.path, existed: file.existed });
    if (file.existed) {
      const saved = await checkedPath(root, `.kadroskop-backups/${id}/${file.path}`);
      const info = await lstat(saved);
      if (!info.isFile() || info.size > 16 * 1024 * 1024)
        throw new Error('Файл копии недоступен или слишком велик.');
    }
  }
  return {
    id,
    targetId,
    targetLabel,
    sourceLabel: typeof data.sourceLabel === 'string' ? data.sourceLabel : null,
    createdAt: data.createdAt,
    kind: data.kind === 'restore' ? 'restore' : 'transfer',
    files,
  };
}
export async function listBackups(
  root: string,
  targetId: string,
  targetLabel: string,
): Promise<SettingsBackup[]> {
  const directory = await checkedPath(root, '.kadroskop-backups');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const result: SettingsBackup[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      result.push(await readBackup(root, entry.name, targetId, targetLabel));
    } catch {
      /* Неполная или повреждённая копия не предлагается для восстановления. */
    }
  }
  return result;
}
export async function restoreBackup(root: string, backup: SettingsBackup) {
  const source = await checkedPath(root, `.kadroskop-backups/${backup.id}`);
  const result = await transferSettings(
    source,
    root,
    backup.files.map((file) => file.path),
    { kind: 'restore' },
    backup.files.filter((file) => !file.existed).map((file) => file.path),
  );
  return { backupPath: result.backupPath, restoredFiles: result.transferredFiles };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
