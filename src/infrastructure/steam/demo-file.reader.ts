import { open } from 'node:fs/promises';

/**
 * Длина повтора: сколько в нём тиков и сколько это в секундах.
 *
 * Нужно ради одного вопроса, на который человек не может ответить сам: «а 5000
 * тиков — это сколько?». Пока экран спрашивает голое число, выбрать точку в
 * матче нельзя — можно только угадать и полчаса смотреть на стадию драфта.
 *
 * Частоту тиков не зашиваем константой, хотя она и равна тридцати: файл
 * сообщает и тики, и секунды, а значит может сказать это сам. Зашитое число
 * однажды разойдётся с игрой и будет врать молча.
 *
 * Читаются два куска файла: заголовок и сводка в конце. Повторы бывают по
 * триста мегабайт, и разбирать их целиком ради двух чисел незачем.
 */

const MAGIC = 'PBDEMS2';
const HEADER_BYTES = 16;

/** Сводка лежит в конце и на общем фоне крошечная. */
const SUMMARY_BYTES = 4096;

/** Номера полей в CDemoFileInfo: время воспроизведения и число тиков. */
const FIELD_PLAYBACK_TIME = 1;
const FIELD_PLAYBACK_TICKS = 2;

const WIRE_VARINT = 0;
const WIRE_LENGTH_PREFIXED = 2;
const WIRE_FIXED32 = 5;

export interface DemoLength {
  readonly ticks: number;
  readonly seconds: number;
}

/**
 * `null`, если файл не повтор, оборван или записан в незнакомом формате.
 *
 * Отсутствие длины — не ошибка: прогон и без неё состоится, просто человеку
 * придётся называть тик вслепую.
 */
export async function readDemoLength(path: string): Promise<DemoLength | null> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return null;
  }

  try {
    const header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    if (header.toString('latin1', 0, MAGIC.length) !== MAGIC) return null;

    // Сразу за меткой — смещение до сводки. У недокачанного повтора там ноль
    // или число за пределами файла: сводку дописывают последней.
    const summaryAt = header.readUInt32LE(8);
    const { size } = await handle.stat();
    if (summaryAt === 0 || summaryAt >= size) return null;

    const summary = Buffer.alloc(Math.min(SUMMARY_BYTES, size - summaryAt));
    await handle.read(summary, 0, summary.length, summaryAt);

    return parseSummary(summary);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** Читатель, помнящий, где остановился: формат весь на переменной длине. */
function reader(buffer: Buffer, from = 0): { varint(): number; at(): number; skip(by: number): void } {
  let at = from;
  return {
    varint(): number {
      let value = 0;
      let shift = 0;
      for (;;) {
        const byte = buffer[at++];
        if (byte === undefined) throw new Error('поток оборван');
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return value;
        shift += 7;
      }
    },
    at: () => at,
    skip: (by: number) => {
      at += by;
    },
  };
}

function parseSummary(summary: Buffer): DemoLength | null {
  const outer = reader(summary);
  outer.varint(); // команда пакета
  outer.varint(); // тик, на котором он записан
  const length = outer.varint();

  const body = summary.subarray(outer.at(), outer.at() + length);
  const inner = reader(body);

  let seconds: number | null = null;
  let ticks: number | null = null;

  while (inner.at() < body.length) {
    const key = inner.varint();
    const field = key >> 3;
    const wire = key & 7;

    if (wire === WIRE_FIXED32) {
      if (field === FIELD_PLAYBACK_TIME) seconds = body.readFloatLE(inner.at());
      inner.skip(4);
    } else if (wire === WIRE_VARINT) {
      const value = inner.varint();
      if (field === FIELD_PLAYBACK_TICKS) ticks = value;
    } else if (wire === WIRE_LENGTH_PREFIXED) {
      inner.skip(inner.varint());
    } else {
      // Незнакомый способ упаковки: дальше читать нечего, но то, что уже
      // прочитали, остаётся верным.
      break;
    }

    if (seconds !== null && ticks !== null) break;
  }

  if (ticks === null || seconds === null || seconds <= 0) return null;
  return { ticks, seconds };
}
