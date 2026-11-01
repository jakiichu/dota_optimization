import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, statfs, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RESOURCES } from '../paths/resources.ts';
import type { SensorStream } from '../../application/ports/sensor-stream.port.ts';
const execute = promisify(execFile);
export interface ReadinessCheck {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'blocked';
  detail: string;
}
export interface CaptureReadiness {
  ready: boolean;
  checkedAt: string;
  checks: ReadinessCheck[];
}

export async function checkCaptureReadiness(
  processName: string,
  sensors: SensorStream,
): Promise<CaptureReadiness> {
  const checks = await Promise.all([
    check('game', 'Игра', async () => {
      if (!/^[\p{L}\p{N}_. -]+\.exe$/iu.test(processName))
        throw new Error('Укажите имя процесса, например dota2.exe.');
      const { stdout } = await execute(
        'tasklist.exe',
        ['/FI', `IMAGENAME eq ${processName}`, '/FO', 'CSV', '/NH'],
        { timeout: 5000, windowsHide: true },
      );
      if (!stdout.toLowerCase().includes(`"${processName.toLowerCase()}",`))
        throw new Error(`Запустите ${processName} и повторите проверку.`);
      return `${processName} запущен.`;
    }),
    check('presentmon', 'Сборщик кадров', async () => {
      let help: string;
      try {
        const result = await execute(RESOURCES.presentMon(), ['--help'], {
          timeout: 5000,
          windowsHide: true,
        });
        help = result.stdout + result.stderr;
      } catch (error) {
        // PresentMon 2.5.1 возвращает справку в stderr с кодом 1.
        const failure = error as { code?: number; stderr?: string; stdout?: string };
        help = (failure.stdout ?? '') + (failure.stderr ?? '');
        if (failure.code !== 1 || !help.startsWith('PresentMon '))
          throw new Error(
            'PresentMon не удалось запустить. Проверьте полноту папки приложения и разрешения запуска.',
            { cause: error },
          );
      }
      if (!help.includes('--qpc_time_ms') || !help.includes('--v2_metrics'))
        throw new Error('Эта версия PresentMon не поддерживает нужный формат записи.');
      return 'PresentMon запускается и поддерживает нужные параметры. Права ETW проверяются при старте записи.';
    }),
    storageCheck('storage', 'Папка записей', RESOURCES.sessionsRoot()),
    storageCheck('temporary', 'Временные файлы', tmpdir()),
    sensorCheck(sensors),
  ]);
  return {
    ready: !checks.some((item) => item.status === 'blocked'),
    checkedAt: new Date().toISOString(),
    checks,
  };
}
async function check(
  id: string,
  label: string,
  run: () => Promise<string>,
): Promise<ReadinessCheck> {
  try {
    return { id, label, status: 'ok', detail: await run() };
  } catch (error) {
    return {
      id,
      label,
      status: 'blocked',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
async function storageCheck(id: string, label: string, directory: string): Promise<ReadinessCheck> {
  let free = 0;
  const result = await check(id, label, async () => {
    await mkdir(directory, { recursive: true });
    const probe = join(directory, `.kadroskop-check-${randomUUID()}`);
    try {
      await writeFile(probe, '', { flag: 'wx' });
    } finally {
      await unlink(probe).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
    const fs = await statfs(directory);
    free = fs.bavail * fs.bsize;
    if (free < 256 * 1024 ** 2)
      throw new Error('Свободно менее 256 МБ. Освободите место перед записью.');
    return `Запись разрешена. Свободно ${(free / 1024 ** 3).toFixed(1)} ГБ. Размер будущей записи заранее неизвестен.`;
  });
  return result.status === 'ok' && free < 2 * 1024 ** 3
    ? {
        ...result,
        status: 'warning',
        detail: result.detail + ' Для длинной записи места может не хватить.',
      }
    : result;
}
export function sensorCheck(sensors: SensorStream, timeoutMs = 2500): Promise<ReadinessCheck> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve({
        id: 'sensors',
        label: 'Датчики',
        status: ok ? 'ok' : 'warning',
        detail: ok
          ? 'Получен замер датчиков. Доступность отдельных показателей зависит от оборудования.'
          : 'За время проверки датчики не ответили. Кадры можно записать, но разбор нагрузки будет ограничен.',
      });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      unsubscribe = sensors.subscribe((sample) => {
        if (sample.cpu !== null || sample.gpus.length > 0) finish(true);
      });
      if (settled) unsubscribe();
    } catch {
      finish(false);
    }
  });
}
