/**
 * Единицы измерения в одном месте.
 *
 * Прочерк вместо нуля — не косметика, а правило: «0 °C» читается как сломанный
 * датчик, а прочерк — как «мы этого не читаем». Раз правило одно на всё
 * приложение, то и функция должна быть одна.
 */

export const UNKNOWN = '—';

export function ms(value: number | null, digits = 1): string {
  return value === null ? UNKNOWN : `${value.toFixed(digits)} мс`;
}

export function percent(value: number | null, digits = 1): string {
  return value === null ? UNKNOWN : `${value.toFixed(digits)} %`;
}

/** Доля 0…1 в проценты. */
export function share(value: number | null, digits = 0): string {
  return value === null ? UNKNOWN : `${(value * 100).toFixed(digits)} %`;
}

export function mib(value: number | null): string {
  return value === null ? UNKNOWN : `${value} МиБ`;
}

export function seconds(value: number | null, digits = 1): string {
  return value === null ? UNKNOWN : `${value.toFixed(digits)} с`;
}

export function withUnit(value: number | null, unit: string, digits = 1): string {
  if (value === null) return UNKNOWN;
  return unit === '' ? value.toFixed(digits) : `${value.toFixed(digits)} ${unit}`;
}

export function signed(value: number, unit: string, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${withUnit(value, unit, digits)}`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru');
}
