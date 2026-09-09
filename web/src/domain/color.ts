/**
 * Цвет как его понимает движок: три числа 0…255.
 *
 * Отдельный модуль, потому что превращение «строка из конфига ↔ цвет на
 * экране» нужно в обе стороны и в нескольких местах. И потому что в файл
 * уходит именно строка — человек должен видеть её целиком, а не только
 * квадратик.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const MAX_CHANNEL = 255;

export function parseRgb(value: string): Rgb | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return null;

  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  if (numbers.some((channel) => channel < 0 || channel > MAX_CHANNEL)) return null;

  return { r: numbers[0] ?? 0, g: numbers[1] ?? 0, b: numbers[2] ?? 0 };
}

/** Ровно то, что уйдёт в файл. */
export function formatRgb(color: Rgb): string {
  return `${color.r} ${color.g} ${color.b}`;
}

export function toHex(color: Rgb): string {
  return `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function fromHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return null;

  const digits = match[1] ?? '';
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

export function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), MAX_CHANNEL);
}

/**
 * Насколько цвет светлый, 0…1.
 *
 * Нужно ровно для одного: подписать сам образец так, чтобы надпись была видна.
 * Чёрный текст на тёмно-синем — обычная беда самодельных подборщиков цвета.
 */
export function luminance(color: Rgb): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / MAX_CHANNEL;
}
