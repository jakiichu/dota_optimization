/**
 * Что делает каждая настройка Dota и чем за неё платят.
 *
 * Конфиги ходят по интернету списками без объяснений: человек вставляет
 * семьдесят строк и не знает, какие из них купили ему кадры, какие изменили
 * игру, а какие не делают ничего. Знание здесь — чтобы инструмент мог сказать
 * это по каждой строке отдельно.
 *
 * Незнакомая настройка честно помечается как незнакомая. Придумывать описание
 * нельзя: цена ошибки — человек оставит вредное, поверив нам.
 */

export type CvarImpact =
  /** Снимает работу с видеокарты. */
  | 'gpu'
  /** Снимает работу с процессора. */
  | 'cpu'
  /** Снимает и с того, и с другого. */
  | 'both'
  /** Меняет саму игру, а не её скорость. */
  | 'gameplay'
  /** Только внешний вид, на скорость влияет незначительно. */
  | 'cosmetic'
  /** На производительность не влияет вовсе. */
  | 'none';

export interface CvarInfo {
  readonly impact: CvarImpact;
  /** Что настройка делает — одной фразой. */
  readonly what: string;
  /** Чем за это платят. Пусто, если не платят ничем. */
  readonly cost: string;
}

/**
 * Чего касается настройка — одной фразой.
 *
 * Формулировка отвечает на вопрос «кто делает эту работу», а не «что будет,
 * если выключить». Второе зависит от машины и выясняется замером: сказать
 * «даёт кадры», глядя только на имя переменной, значило бы делать ровно то, за
 * что мы ругаем конфиги из интернета. Оговорка про замер стоит один раз над
 * группой, а не семьдесят раз в строках.
 */
export const IMPACT_LABEL: Record<CvarImpact, string> = {
  gpu: 'рисует видеокарта',
  cpu: 'считает процессор',
  both: 'считает процессор, рисует видеокарта',
  gameplay: 'меняет игру, а не скорость',
  cosmetic: 'только внешний вид',
  none: 'на скорость не влияет',
};

const KNOWLEDGE: Readonly<Record<string, CvarInfo>> = {
  fps_max: {
    impact: 'both',
    what: 'потолок кадров в секунду',
    cost: 'ноль снимает потолок целиком: нагрев, шум и гонка с развёрткой',
  },
  r_ssao: {
    impact: 'gpu',
    what: 'затенение в углах и стыках',
    cost: 'картинка становится плоской',
  },
  r_deferred_additive_pass: { impact: 'gpu', what: 'дополнительный проход освещения', cost: '' },
  r_deferred_simple_light: { impact: 'gpu', what: 'упрощённое освещение', cost: '' },
  r_deferred_specular: { impact: 'gpu', what: 'блики на поверхностях', cost: 'мир выглядит матовым' },
  r_deferred_specular_bloom: { impact: 'gpu', what: 'свечение бликов', cost: '' },
  r_deferred_height_fog: { impact: 'gpu', what: 'объёмный туман', cost: '' },
  r_dota_normal_maps: {
    impact: 'gpu',
    what: 'рельеф текстур',
    cost: 'поверхности становятся гладкими',
  },
  r_dota_allow_parallax_mapping: { impact: 'gpu', what: 'иллюзия глубины текстур', cost: '' },
  r_grass_quality: { impact: 'gpu', what: 'качество травы', cost: '' },
  r_dota_fxaa: { impact: 'gpu', what: 'дешёвое сглаживание', cost: 'картинка слегка мылит' },
  dota_cheap_water: { impact: 'gpu', what: 'упрощённая вода', cost: '' },
  r_texturefilteringquality: {
    impact: 'gpu',
    what: 'качество фильтрации текстур',
    cost: 'текстуры под углом становятся размытыми',
  },
  r_depth_of_field: { impact: 'gpu', what: 'размытие глубины', cost: '' },
  r_dota_color_correction: { impact: 'gpu', what: 'цветокоррекция', cost: 'цвета становятся тусклее' },
  r_dota_render_2d_skybox: { impact: 'gpu', what: 'фон неба', cost: '' },
  r_dashboard_render_quality: { impact: 'gpu', what: 'качество отрисовки меню', cost: '' },
  r_dynamiclighting: { impact: 'gpu', what: 'динамическое освещение', cost: '' },
  r_light_flickering_enabled: { impact: 'gpu', what: 'мерцание источников света', cost: '' },
  r_dota_shadow_ambient_light: { impact: 'gpu', what: 'подсветка теней', cost: '' },
  r_dota_local_light_compute: { impact: 'gpu', what: 'расчёт локальных источников света', cost: '' },
  r_dota_bloom_compute_shader: { impact: 'gpu', what: 'способ расчёта свечения', cost: '' },
  r_decal_cullsize: { impact: 'gpu', what: 'отсечение мелких наложений', cost: '' },
  r_character_decal_resolution: { impact: 'gpu', what: 'разрешение наложений на моделях', cost: '' },
  r_renderoverlayfragment: { impact: 'gpu', what: 'отрисовка накладываемых фрагментов', cost: '' },

  // Тени: самая дорогая часть кадра и по видеокарте, и по процессору.
  cl_globallight_shadow_mode: { impact: 'both', what: 'режим общих теней', cost: 'тени грубеют или пропадают' },
  csm_viewmodel_shadows: { impact: 'gpu', what: 'тени от модели', cost: '' },
  lb_shadow_texture_height_override: { impact: 'both', what: 'высота карты теней', cost: 'тени становятся угловатыми' },
  lb_shadow_texture_width_override: { impact: 'both', what: 'ширина карты теней', cost: 'тени становятся угловатыми' },
  lb_dynamic_shadow_resolution_base: { impact: 'both', what: 'разрешение динамических теней', cost: '' },
  lb_dynamic_shadow_resolution_delay: { impact: 'both', what: 'задержка обновления теней', cost: '' },
  r_dota_spotlight_shadows_resolution: { impact: 'both', what: 'разрешение теней прожекторов', cost: '' },
  r_dota_allow_spotlight_shadows: { impact: 'both', what: 'тени от прожекторов', cost: '' },
  sc_shadow_depth_bias: { impact: 'gpu', what: 'смещение глубины теней', cost: '' },

  // Частицы: в замесах это главная нагрузка на процессор.
  cl_particle_fallback_base: { impact: 'cpu', what: 'с какого уровня упрощать частицы', cost: 'эффекты беднее' },
  cl_particle_fallback_multiplier: { impact: 'cpu', what: 'насколько агрессивно упрощать частицы', cost: 'эффекты беднее' },
  cl_particle_sim_fallback_base_multiplier: { impact: 'cpu', what: 'упрощение расчёта частиц', cost: '' },
  cl_particle_sim_fallback_threshold_ms: {
    impact: 'cpu',
    what: 'порог времени, после которого частицы упрощаются',
    cost: '',
  },
  cl_aggregate_particles: { impact: 'cpu', what: 'объединение частиц в пакеты', cost: '' },
  cl_retire_low_priority_lights: { impact: 'both', what: 'отключение неважных источников света', cost: '' },
  dota_allow_clientside_particles: { impact: 'cpu', what: 'частицы, считаемые на клиенте', cost: '' },
  dota_disable_particle_lights: { impact: 'both', what: 'свет от частиц', cost: '' },
  r_particle_max_detail_level: { impact: 'both', what: 'детализация частиц', cost: '' },
  r_particle_max_texture_layers: { impact: 'gpu', what: 'слои текстур у частиц', cost: '' },
  r_particle_cables_cast_shadows: { impact: 'gpu', what: 'тени от тросов', cost: '' },
  r_dota_disable_weather_particles: { impact: 'both', what: 'погодные эффекты', cost: 'погода перестаёт быть видна' },
  dota_unit_fly_particle: { impact: 'cpu', what: 'частицы у летающих юнитов', cost: '' },
  dota_building_destruction_effects: { impact: 'both', what: 'эффекты разрушения зданий', cost: '' },

  // Окружение и мелочи, считаемые процессором.
  dota_ambient_creatures: { impact: 'cpu', what: 'зверьки на карте', cost: '' },
  dota_ambient_cloth: { impact: 'cpu', what: 'колыхание ткани', cost: '' },
  r_dota_allow_wind_on_trees: { impact: 'cpu', what: 'ветер в деревьях', cost: '' },
  dota_portrait_animate: { impact: 'cpu', what: 'анимация портрета героя', cost: '' },
  map_enable_portrait_worlds: { impact: 'both', what: 'отдельная сцена для портрета', cost: '' },
  sc_clutter_density_full_size: { impact: 'both', what: 'плотность мелких объектов', cost: '' },
  r_aoproxy_cull_dist: { impact: 'gpu', what: 'дальность приближённого затенения', cost: '' },
  r_aoproxy_min_dist: { impact: 'gpu', what: 'ближняя граница приближённого затенения', cost: '' },
  panorama_allow_transitions: { impact: 'cpu', what: 'анимации интерфейса', cost: '' },
  dota_sf_hud_disable_fade: { impact: 'cpu', what: 'плавное исчезание интерфейса', cost: '' },
  dota_defer_panorama_on_sim_ticks: { impact: 'cpu', what: 'откладывание отрисовки интерфейса', cost: '' },
  r_experimental_lag_limiter: {
    impact: 'both',
    what: 'экспериментальный ограничитель задержки',
    cost: 'поведение не документировано',
  },
  r_dota_allow_desaturate_layers: { impact: 'gpu', what: 'обесцвечивание слоёв', cost: '' },
  engine_enable_frametime_warnings: { impact: 'none', what: 'предупреждения движка о долгих кадрах', cost: '' },

  // Не про производительность.
  violence_ablood: { impact: 'cosmetic', what: 'кровь у существ', cost: '' },
  violence_agibs: { impact: 'cosmetic', what: 'останки существ', cost: '' },
  violence_hblood: { impact: 'cosmetic', what: 'кровь у героев', cost: '' },
  violence_hgibs: { impact: 'cosmetic', what: 'останки героев', cost: '' },
  dota_unit_use_player_color: { impact: 'gameplay', what: 'подсветка юнитов цветом игрока', cost: '' },
  dota_friendly_color: { impact: 'gameplay', what: 'цвет союзников', cost: '' },
  dota_enemy_color: { impact: 'gameplay', what: 'цвет противников', cost: '' },
  dota_selection_groups: {
    impact: 'gameplay',
    what: 'группы выделения юнитов',
    cost: 'выключение меняет управление, а не скорость',
  },
  dota_hero_auto_graball: { impact: 'gameplay', what: 'автоподбор предметов героем', cost: '' },
  r_draw_selected_ring: { impact: 'cosmetic', what: 'кольцо под выделенным юнитом', cost: '' },
  con_enable: { impact: 'none', what: 'консоль разработчика', cost: '' },
};

export function describeCvar(name: string): CvarInfo | null {
  return KNOWLEDGE[name.toLowerCase()] ?? null;
}
