/**
 * Как строка конфига называется в меню самой игры.
 *
 * Смысл один: человек ищет настройку глазами там, где привык, — в меню. Строка
 * `dota_ambient_creatures` ему ничего не говорит, а «Фауна» говорит сразу. Наше
 * описание («зверьки на карте») тоже помогает, но оно наше, а меню — общее.
 *
 * Тексты берутся у самой игры, на языке её интерфейса; здесь только
 * соответствие «переменная — ключ в файле локализации». Список короткий
 * намеренно: в нём лишь те пары, где соответствие очевидно. Ошибиться тут
 * дороже, чем промолчать, — человек пойдёт в меню и не найдёт того, что мы
 * пообещали.
 */

/** Названия настроек, прочитанные у игры: ключ локализации → текст из меню. */
export type SettingNames = ReadonlyMap<string, string>;

export interface InGameSetting {
  readonly label: string;
  /**
   * Значение переменной противоположно галочке в меню.
   *
   * Это не мелочь: `dota_cheap_water 1` означает, что «Высокое качество воды»
   * **выключено**. Не сказав об этом, мы подписали бы строку названием, смысл
   * которого обратный.
   */
  readonly inverted: boolean;
}

interface MenuLink {
  readonly key: string;
  readonly inverted?: boolean;
}

const MENU: Readonly<Record<string, MenuLink>> = {
  fps_max: { key: 'dota_settings_fps_max' },

  // Обычные галочки: единица в конфиге — включено и в меню.
  dota_ambient_creatures: { key: 'dota_settings_ambientcreatures' },
  dota_ambient_cloth: { key: 'dota_settings_ambient_cloth' },
  dota_portrait_animate: { key: 'dota_settings_animateportrait' },
  r_grass_quality: { key: 'dota_settings_grassquality' },
  r_ssao: { key: 'dota_settings_ambientocclusion' },
  r_deferred_specular: { key: 'dota_settings_specular' },
  r_deferred_specular_bloom: { key: 'dota_settings_bloom' },
  r_deferred_height_fog: { key: 'dota_settings_fog' },
  r_deferred_additive_pass: { key: 'dota_settings_additivelight' },
  r_dota_normal_maps: { key: 'dota_settings_normal_maps' },
  r_dashboard_render_quality: { key: 'dota_settings_dashboard_renderquality' },
  cl_globallight_shadow_mode: { key: 'dota_settings_shadowquality' },

  // Один пункт меню задаёт обе переменные разом.
  cl_particle_fallback_base: { key: 'dota_settings_particlequality' },
  cl_particle_fallback_multiplier: { key: 'dota_settings_particlequality' },

  // Переменная названа от обратного: включив её, галочку в меню вы снимаете.
  dota_cheap_water: { key: 'dota_settings_waterquality', inverted: true },
  r_deferred_simple_light: { key: 'dota_settings_worldlight', inverted: true },
};

export function inGameSetting(cvar: string, names: SettingNames): InGameSetting | null {
  const link = MENU[cvar.toLowerCase()];
  if (link === undefined) return null;

  const label = names.get(link.key);
  // Названия не прочитались или игра переименовала пункт — молчим. Подставлять
  // сюда своё значило бы выдать нашу догадку за текст из игры.
  if (label === undefined) return null;

  return { label, inverted: link.inverted === true };
}
