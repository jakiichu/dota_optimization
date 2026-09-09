/**
 * Какого вида значение у настройки — и, значит, чем его редактировать.
 *
 * Правило простое и намеренно осторожное: угадывать нельзя. Ошибка здесь
 * выглядит безобиднее, чем есть, — если показать переключатель там, где нужно
 * число, человек молча запишет в конфиг единицу вместо трёхсот и будет искать,
 * почему стало хуже.
 *
 * Поэтому незнакомая настройка правится обычным текстовым полем: пусть
 * неудобно, зато мы ничего о ней не выдумали.
 */

export type CvarValueKind =
  /** Ноль или единица: выключено или включено. */
  | 'toggle'
  /** Три числа 0…255 — цвет. */
  | 'color'
  /** Число, у которого есть смысл кроме нуля и единицы. */
  | 'number'
  /** Всё остальное: правим как текст. */
  | 'text';

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Настройки, где ноль и единица — это числа, а не «выкл» и «вкл».
 *
 * Без этого списка `fps_max 0` превратился бы в переключатель, а снятый
 * потолок кадров — в «выключено». Список ведётся вручную: он короткий, и это
 * ровно те места, где ошибка дорого стоит.
 */
const NUMERIC = new Set([
  'fps_max',
  'cl_particle_fallback_base',
  'cl_particle_fallback_multiplier',
  'cl_particle_sim_fallback_base_multiplier',
  'cl_particle_sim_fallback_threshold_ms',
  'cl_globallight_shadow_mode',
  'lb_shadow_texture_height_override',
  'lb_shadow_texture_width_override',
  'lb_dynamic_shadow_resolution_base',
  'lb_dynamic_shadow_resolution_delay',
  'r_dota_spotlight_shadows_resolution',
  'r_texturefilteringquality',
  'r_grass_quality',
  'r_particle_max_detail_level',
  'r_particle_max_texture_layers',
  'r_decal_cullsize',
  'r_character_decal_resolution',
  'r_dashboard_render_quality',
  'r_aoproxy_cull_dist',
  'r_aoproxy_min_dist',
  'sc_shadow_depth_bias',
  'sc_clutter_density_full_size',
]);

const MAX_CHANNEL = 255;

export function valueKindOf(name: string, value: string, known: boolean): CvarValueKind {
  if (parseRgb(value) !== null) return 'color';
  if (NUMERIC.has(name.toLowerCase())) return 'number';
  // Переключатель предлагаем только для знакомых настроек: у незнакомой
  // единица может означать что угодно, включая «режим 1 из пяти».
  if (known && (value === '0' || value === '1')) return 'toggle';
  return 'text';
}

/** Цвет вида `0 255 255`. Иначе — null, и это не ошибка, а «не цвет». */
export function parseRgb(value: string): Rgb | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return null;

  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  if (numbers.some((channel) => channel < 0 || channel > MAX_CHANNEL)) return null;

  return { r: numbers[0] ?? 0, g: numbers[1] ?? 0, b: numbers[2] ?? 0 };
}

/** Обратно в тот вид, который понимает движок. */
export function formatRgb(color: Rgb): string {
  return `${color.r} ${color.g} ${color.b}`;
}

export function rgbToHex(color: Rgb): string {
  return `#${[color.r, color.g, color.b].map(channelToHex).join('')}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return null;

  const digits = match[1] ?? '';
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function channelToHex(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}
