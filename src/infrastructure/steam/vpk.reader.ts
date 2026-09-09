import { open, readFile } from 'node:fs/promises';

/**
 * Чтение архивов VPK — так Valve хранит ресурсы игры.
 *
 * Нужно ради одной вещи: в архивах лежат настоящие названия настроек, те самые,
 * что человек видит в меню игры. Свои описания у нас есть, но «Фауна» из меню и
 * «зверьки на карте» из нашей таблицы — это одна и та же строка конфига, и
 * связать их может только сама игра.
 *
 * Формат простой и стабильный много лет: заголовок, дерево «расширение → путь →
 * имя», а данные — в пронумерованных файлах рядом. Читаем только каталог и один
 * нужный файл; распаковывать двадцать гигабайт незачем.
 *
 * Только чтение. Ни один файл игры здесь не меняется.
 */

const SIGNATURE = 0x55aa1234;
const HEADER_V1 = 12;
const HEADER_V2 = 28;

/** Данные лежат в этом же файле, а не в отдельном архиве. */
const INLINE_ARCHIVE = 0x7fff;

export interface VpkEntry {
  /** Путь внутри архива, например `resource/localization/dota_russian.txt`. */
  readonly path: string;
  readonly archiveIndex: number;
  readonly offset: number;
  readonly length: number;
  /** Начало файла, вшитое прямо в каталог. Обычно пусто. */
  readonly preload: Buffer;
}

export interface VpkIndex {
  readonly entries: ReadonlyMap<string, VpkEntry>;
  /** Где в файле каталога кончается дерево: отсюда считаются вшитые данные. */
  readonly dataStart: number;
}

export async function readVpkIndex(dirPath: string): Promise<VpkIndex> {
  const buffer = await readFile(dirPath);
  if (buffer.length < HEADER_V1 || buffer.readUInt32LE(0) !== SIGNATURE) {
    throw new Error(`${dirPath} не похож на VPK.`);
  }

  const version = buffer.readUInt32LE(4);
  let at = version === 2 ? HEADER_V2 : HEADER_V1;

  const readString = (): string => {
    const end = buffer.indexOf(0, at);
    if (end === -1) throw new Error('Каталог VPK оборван.');
    const value = buffer.toString('utf8', at, end);
    at = end + 1;
    return value;
  };

  const entries = new Map<string, VpkEntry>();
  for (;;) {
    const extension = readString();
    if (extension === '') break;

    for (;;) {
      const folder = readString();
      if (folder === '') break;

      for (;;) {
        const name = readString();
        if (name === '') break;

        at += 4; // контрольная сумма — нам она не нужна
        const preloadBytes = buffer.readUInt16LE(at);
        const archiveIndex = buffer.readUInt16LE(at + 2);
        const offset = buffer.readUInt32LE(at + 4);
        const length = buffer.readUInt32LE(at + 8);
        at += 14; // 2 + 2 + 4 + 4 и двухбайтовый признак конца записи

        const preload = buffer.subarray(at, at + preloadBytes);
        at += preloadBytes;

        entries.set(`${folder}/${name}.${extension}`, {
          path: `${folder}/${name}.${extension}`,
          archiveIndex,
          offset,
          length,
          preload,
        });
      }
    }
  }

  return { entries, dataStart: at };
}

/**
 * Достаёт один файл.
 *
 * Читаем ровно нужный кусок нужного архива: локализация — это пять мегабайт
 * внутри архива на несколько гигабайт, и загружать весь архив ради неё нельзя.
 */
export async function readVpkFile(
  dirPath: string,
  index: VpkIndex,
  entry: VpkEntry,
): Promise<Buffer> {
  if (entry.length === 0) return Buffer.from(entry.preload);

  // Файл либо лежит в отдельном архиве со своего нуля, либо вшит в сам каталог —
  // и тогда смещение считается от конца дерева, а не от начала файла.
  const inline = entry.archiveIndex === INLINE_ARCHIVE;
  const source = inline ? dirPath : archivePath(dirPath, entry.archiveIndex);
  const start = inline ? index.dataStart + entry.offset : entry.offset;

  const handle = await open(source, 'r');
  try {
    const body = Buffer.alloc(entry.length);
    await handle.read(body, 0, entry.length, start);
    return entry.preload.length === 0 ? body : Buffer.concat([entry.preload, body]);
  } finally {
    await handle.close();
  }
}

/** `pak01_dir.vpk` → `pak01_042.vpk`. */
function archivePath(dirPath: string, archiveIndex: number): string {
  return dirPath.replace(/_dir\.vpk$/i, `_${String(archiveIndex).padStart(3, '0')}.vpk`);
}
