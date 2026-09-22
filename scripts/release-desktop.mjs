import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensurePresentMon } from './fetch-presentmon.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, shell = false) => {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell });
  if (result.status !== 0) throw new Error(`Не выполнено: ${cmd} (${result.status})`);
};
if (await ensurePresentMon() === null) throw new Error('Не удалось подготовить PresentMon для сборки.');
const sidecar = join(root, 'build/desktop-sidecar');
run('dotnet', ['publish', 'sidecar/Kadroskop.Sidecar/Kadroskop.Sidecar.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-p:PublishTrimmed=false', '-o', sidecar, '--nologo']);
await import('./build-desktop.mjs');
const electron = createRequire(import.meta.url)('electron');
// Новый каталог каждой сборки: не трогаем работающий экземпляр и записи пользователя.
const out = join(root, 'release', `desktop-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });
cpSync(dirname(electron), out, { recursive: true });
renameSync(join(out, 'electron.exe'), join(out, 'Кадроскоп.exe'));
const application = join(out, 'resources/app');
cpSync(join(root, 'build/desktop'), application, { recursive: true });
cpSync(sidecar, join(application, 'assets'), { recursive: true });
if (!existsSync(join(application, 'assets/PresentMon.exe'))) throw new Error('В сборке отсутствует PresentMon.');
writeFileSync(join(out, 'ЧИТАЙ.txt'), 'Запустите Кадроскоп.exe. Крестик сворачивает окно в трей. Выход — через меню значка рядом с часами.\nЗаписи хранятся в %APPDATA%/Кадроскоп/sessions и сохраняются при обновлении программы.\nДля переноса старых записей скопируйте содержимое прежней папки sessions сюда при закрытом приложении.\n', 'utf8');
process.stdout.write(`\nГотово: ${join(out, 'Кадроскоп.exe')}\nПередавайте всю папку, а не только exe.\n`);
