import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  elevatedCommand,
  presentMonFailure,
} from '../../src/infrastructure/presentmon/elevated-command.ts';
const execute = promisify(execFile);

describe('запуск PresentMon', () => {
  it('различает отмену UAC, тайм-аут и ошибку инструмента', () => {
    expect(presentMonFailure(Object.assign(new Error(), { code: 1223 })).message).toContain(
      'отклонён',
    );
    expect(presentMonFailure(Object.assign(new Error(), { killed: true })).message).toContain(
      'тайм-аут',
    );
    expect(
      presentMonFailure(Object.assign(new Error(), { code: 7, stderr: 'bad option' })).message,
    ).toContain('bad option');
  });
  it.skipIf(process.platform !== 'win32')(
    'сохраняет аргументы с пробелами, кавычками и кириллицей и возвращает код дочернего процесса',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'kadroskop launch '));
      try {
        const helper = join(root, 'helper.cjs');
        const output = join(root, 'arguments.json');
        await writeFile(
          helper,
          'require("node:fs").writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));process.exit(37);',
        );
        const values = [
          'C:\\Users\\Имя Фамилия\\frames.csv',
          "O'Brien",
          'quote"inside',
          'trailing\\',
          '$notExpanded; literal',
        ];
        // Проверяем тот же Start-Process без повышения, чтобы тест не вызывал UAC.
        const command = elevatedCommand(process.execPath, [helper, output, ...values]).replace(
          '-Verb RunAs ',
          '',
        );
        const env = { ...process.env };
        for (const key of Object.keys(env))
          if (key.toLowerCase() === 'psmodulepath') delete env[key];
        await expect(
          execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
            windowsHide: true,
            timeout: 15000,
            env,
          }),
        ).rejects.toMatchObject({ code: 37 });
        expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(values);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
