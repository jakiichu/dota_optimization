import { describe, expect, it } from 'vitest';
import {
  formatRgb,
  hexToRgb,
  parseRgb,
  rgbToHex,
  valueKindOf,
} from '../../src/domain/gameconfig/cvar-value.ts';

describe('valueKindOf', () => {
  it('не превращает fps_max 0 в переключатель', () => {
    // Иначе снятый потолок кадров выглядел бы как «выключено», а человек,
    // щёлкнув, записал бы в конфиг единицу — один кадр в секунду.
    expect(valueKindOf('fps_max', '0', true)).toBe('number');
  });

  it('даёт переключатель знакомой настройке с нулём или единицей', () => {
    expect(valueKindOf('dota_ambient_creatures', '0', true)).toBe('toggle');
  });

  it('не гадает про незнакомую настройку', () => {
    // У незнакомой единица может означать «режим 1 из пяти».
    expect(valueKindOf('какая_то_переменная', '1', false)).toBe('text');
  });

  it('узнаёт цвет по трём числам', () => {
    expect(valueKindOf('dota_friendly_color', '0 255 255', true)).toBe('color');
  });
});

describe('parseRgb', () => {
  it('разбирает три числа', () => {
    expect(parseRgb('0 255 128')).toEqual({ r: 0, g: 255, b: 128 });
  });

  it('отказывается от значений вне 0…255', () => {
    expect(parseRgb('0 300 0')).toBeNull();
  });

  it('отказывается от двух чисел', () => {
    expect(parseRgb('0 255')).toBeNull();
  });

  it('возвращает то же, что получил', () => {
    expect(formatRgb({ r: 0, g: 255, b: 128 })).toBe('0 255 128');
  });
});

describe('rgbToHex', () => {
  it('дополняет короткие каналы нулём', () => {
    expect(rgbToHex({ r: 0, g: 15, b: 255 })).toBe('#000fff');
  });

  it('читается обратно', () => {
    expect(hexToRgb('#000fff')).toEqual({ r: 0, g: 15, b: 255 });
  });

  it('не принимает мусор', () => {
    expect(hexToRgb('синий')).toBeNull();
  });
});
