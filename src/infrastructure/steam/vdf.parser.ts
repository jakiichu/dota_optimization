/**
 * Минимальный разбор текстового VDF — формата конфигов Valve.
 *
 * Полноценный парсер не нужен: нам хватает вложенных объектов и строковых
 * значений. Зато нужен предсказуемый, потому что регулярками по localconfig.vdf
 * рано или поздно вытащишь LaunchOptions от соседней игры.
 */
export type VdfValue = string | VdfObject;
export interface VdfObject {
  readonly [key: string]: VdfValue;
}

const QUOTE = '"';
const OPEN = '{';
const CLOSE = '}';

interface Cursor {
  readonly text: string;
  index: number;
}

export function parseVdf(text: string): VdfObject {
  const cursor: Cursor = { text, index: 0 };
  const root: Record<string, VdfValue> = {};

  for (;;) {
    skipTrivia(cursor);
    if (cursor.index >= text.length) break;
    if (text[cursor.index] === CLOSE) {
      cursor.index += 1;
      continue;
    }
    const key = readKey(cursor);
    if (key === null) break;
    root[key] = readValue(cursor);
  }

  return root;
}

/** Достаёт значение по пути, не падая на отсутствующих уровнях. */
export function vdfString(root: VdfObject, ...path: readonly string[]): string | null {
  let current: VdfValue | undefined = root;
  for (const segment of path) {
    if (typeof current !== 'object') return null;
    current = lookupCaseInsensitive(current, segment);
    if (current === undefined) return null;
  }
  return typeof current === 'string' ? current : null;
}

export function vdfObject(root: VdfObject, ...path: readonly string[]): VdfObject | null {
  let current: VdfValue | undefined = root;
  for (const segment of path) {
    if (typeof current !== 'object') return null;
    current = lookupCaseInsensitive(current, segment);
    if (current === undefined) return null;
  }
  return typeof current === 'object' ? current : null;
}

/** Ключи в конфигах Valve встречаются в разном регистре: `apps` и `Apps`. */
function lookupCaseInsensitive(object: VdfObject, key: string): VdfValue | undefined {
  const direct = object[key];
  if (direct !== undefined) return direct;
  const lowered = key.toLowerCase();
  for (const candidate of Object.keys(object)) {
    if (candidate.toLowerCase() === lowered) return object[candidate];
  }
  return undefined;
}

function skipTrivia(cursor: Cursor): void {
  const { text } = cursor;
  for (;;) {
    while (cursor.index < text.length && /\s/.test(text[cursor.index] ?? '')) {
      cursor.index += 1;
    }
    if (text.startsWith('//', cursor.index)) {
      const lineEnd = text.indexOf('\n', cursor.index);
      cursor.index = lineEnd === -1 ? text.length : lineEnd + 1;
      continue;
    }
    return;
  }
}

function readKey(cursor: Cursor): string | null {
  skipTrivia(cursor);
  return cursor.text[cursor.index] === QUOTE ? readQuoted(cursor) : null;
}

function readValue(cursor: Cursor): VdfValue {
  skipTrivia(cursor);
  const { text } = cursor;

  if (text[cursor.index] === OPEN) {
    cursor.index += 1;
    const nested: Record<string, VdfValue> = {};
    for (;;) {
      skipTrivia(cursor);
      if (cursor.index >= text.length) break;
      if (text[cursor.index] === CLOSE) {
        cursor.index += 1;
        break;
      }
      const key = readKey(cursor);
      if (key === null) break;
      nested[key] = readValue(cursor);
    }
    return nested;
  }

  return text[cursor.index] === QUOTE ? readQuoted(cursor) : '';
}

function readQuoted(cursor: Cursor): string {
  const { text } = cursor;
  cursor.index += 1; // открывающая кавычка
  let result = '';

  while (cursor.index < text.length) {
    const char = text[cursor.index];
    if (char === '\\') {
      const next = text[cursor.index + 1];
      result += next === undefined ? '' : unescape(next);
      cursor.index += 2;
      continue;
    }
    if (char === QUOTE) {
      cursor.index += 1;
      return result;
    }
    result += char;
    cursor.index += 1;
  }

  return result;
}

function unescape(char: string): string {
  if (char === 'n') return '\n';
  if (char === 't') return '\t';
  return char;
}
