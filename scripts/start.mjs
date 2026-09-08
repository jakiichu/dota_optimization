import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Единственная команда запуска: `npm start`.
 *
 * Дособирает то, чего не хватает, и поднимает приложение. Смысл в том, чтобы
 * между «склонировал репозиторий» и «вижу окно» не было списка шагов, который
 * надо помнить.
 *
 * Для готового к переносу приложения есть `npm run release` — там ни Node, ни
 * .NET на целевой машине не нужны вовсе.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const STEPS = [
  {
    marker: join(ROOT, 'node_modules', '.package-lock.json'),
    what: 'зависимости',
    command: ['npm', ['install', '--no-audit', '--no-fund']],
  },
  {
    marker: join(ROOT, 'sidecar', 'bin', 'frameloss-sidecar.exe'),
    what: 'сайдкар показаний',
    command: ['npm', ['run', 'sidecar:build']],
    // Без .NET SDK сайдкар не собрать, но аудит и запись кадров работают и без
    // него — поэтому это предупреждение, а не остановка.
    optional: true,
    hint: 'Показаний видеоадаптеров не будет. Поставьте .NET SDK: winget install Microsoft.DotNet.SDK.10',
  },
  {
    marker: join(ROOT, 'web', 'dist', 'index.html'),
    what: 'интерфейс',
    command: ['npm', ['run', 'ui:build']],
  },
];

for (const step of STEPS) {
  if (existsSync(step.marker)) continue;

  process.stdout.write(`Собираю ${step.what}…\n`);
  const [command, args] = step.command;
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: true });

  if (result.status !== 0) {
    if (step.optional === true) {
      process.stdout.write(`Не удалось собрать ${step.what}. ${step.hint}\n\n`);
      continue;
    }
    process.stderr.write(`Не удалось собрать ${step.what}.\n`);
    process.exit(1);
  }
}

const server = spawn(process.execPath, [join(ROOT, 'src', 'main', 'server.ts'), '--open'], {
  cwd: ROOT,
  stdio: 'inherit',
});

server.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => server.kill());
process.on('SIGTERM', () => server.kill());
