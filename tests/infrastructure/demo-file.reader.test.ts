import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDemoLength } from '../../src/infrastructure/steam/demo-file.reader.ts';

/**
 * Проверка на выдуманном файле: тест должен проходить и там, где Dota не
 * установлена. Числа при этом настоящие — они прочитаны из повтора матча
 * 8865634649 и совпадают с тем, что показывает клиент.
 */

const REAL_TICKS = 176_355;
const REAL_SECONDS = 5879.03;

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return bytes;
}

/** Собирает повтор: заголовок, смещение до сводки и сама сводка в конце. */
function buildDemo(options: { ticks?: number; seconds?: number; summaryAt?: number } = {}): Buffer {
  const time = Buffer.alloc(4);
  time.writeFloatLE(options.seconds ?? REAL_SECONDS);

  const body = Buffer.from([
    (1 << 3) | 5, // playback_time, fixed32
    ...time,
    (2 << 3) | 0, // playback_ticks, varint
    ...varint(options.ticks ?? REAL_TICKS),
  ]);

  const packet = Buffer.from([
    ...varint(8), // DEM_FileInfo
    ...varint(0), // тик пакета
    ...varint(body.length),
    ...body,
  ]);

  const header = Buffer.alloc(16);
  header.write('PBDEMS2\0', 0, 'latin1');
  const padding = Buffer.alloc(64);
  header.writeUInt32LE(options.summaryAt ?? header.length + padding.length, 8);

  return Buffer.concat([header, padding, packet]);
}

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'frameloss-demo-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function write(data: Buffer): Promise<string> {
  const path = join(workDir, 'replay.dem');
  await writeFile(path, data);
  return path;
}

describe('readDemoLength', () => {
  it('читает длину повтора в тиках и секундах', async () => {
    const length = await readDemoLength(await write(buildDemo()));

    expect(length?.ticks).toBe(REAL_TICKS);
    expect(length?.seconds).toBeCloseTo(REAL_SECONDS, 1);
  });

  it('даёт ровно тридцать тиков в секунду — как в самой игре', async () => {
    // Частоту нигде не зашиваем, но проверить, что из файла выходит именно
    // она, полезно: на этом числе человек считает, куда ставить тик.
    const length = await readDemoLength(await write(buildDemo()));

    expect((length?.ticks ?? 0) / (length?.seconds ?? 1)).toBeCloseTo(30, 1);
  });

  it('молчит про недокачанный повтор', async () => {
    // У оборванной загрузки сводки нет вовсе: её дописывают последней.
    const length = await readDemoLength(await write(buildDemo({ summaryAt: 0 })));

    expect(length).toBeNull();
  });

  it('молчит про смещение за пределами файла', async () => {
    const length = await readDemoLength(await write(buildDemo({ summaryAt: 999_999 })));

    expect(length).toBeNull();
  });

  it('молчит про файл, который не повтор', async () => {
    expect(await readDemoLength(await write(Buffer.from('просто текст')))).toBeNull();
  });

  it('молчит про несуществующий файл', async () => {
    expect(await readDemoLength(join(workDir, 'нет-такого.dem'))).toBeNull();
  });
});
