import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * Режим разработки: наш сервер данных и dev-сервер Vite рядом.
 *
 * Два процесса, а не один: Vite нужен свой порт и своя горячая перезагрузка, а
 * прокси на /api ведёт к нашему серверу. Скрипт нужен только чтобы не заводить
 * concurrently ради двух команд.
 */
const UI_URL = 'http://127.0.0.1:7330';

const children = [
  spawn(process.execPath, ['src/main/server.ts'], { stdio: 'inherit', shell: false }),
  spawn('npm', ['run', 'ui'], { stdio: 'inherit', shell: true }),
];

process.stdout.write(`\nИнтерфейс: ${UI_URL}\n\n`);

let shuttingDown = false;
const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
};

for (const child of children) {
  child.on('exit', (code) => shutdown(code ?? 0));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
