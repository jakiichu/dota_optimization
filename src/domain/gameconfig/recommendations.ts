import type { FrameStatistics } from '../telemetry/frame-metrics.ts';
import type { NetworkQuality } from '../telemetry/network-quality.ts';
import type { CorrelationReport } from '../telemetry/stutter-correlation.ts';
import { findSetting, type GameConfig } from './game-config.ts';

/**
 * Что попробовать поменять — исходя из того, что измерено.
 *
 * Ловушка этого экрана очевидна: он легко превращается в очередной список
 * советов из интернета, только с приличным оформлением. Отличает нас
 * единственное — числа, поэтому здесь запрещены рекомендации «вообще».
 *
 * Каждая несёт три вещи: повод из конкретной записи, изменение и **предсказание,
 * что именно должно сдвинуться**. Последнее делает совет опровержимым: после
 * повторного замера сравнение либо подтвердит его, либо нет.
 *
 * И столь же важное: там, где конфиг не поможет, так и написано. Троттлинг и
 * сеть настройками графики не лечатся, и предлагать их — обманывать.
 */

export type RecommendationKind =
  | 'frame-cap'
  | 'cpu-relief'
  | 'gpu-relief'
  | 'present-mode'
  | 'not-config';

/**
 * Насколько мы уверены.
 *
 * `measured` — повод виден прямо в записи. `likely` — следует из неё с
 * оговоркой. Ничего слабее в список не попадает: гадание здесь ничем не лучше
 * гадания в интернете.
 */
export type Confidence = 'measured' | 'likely';

export interface ConfigChange {
  readonly cvar: string;
  readonly value: string;
  readonly why: string;
}

export interface Recommendation {
  readonly kind: RecommendationKind;
  readonly title: string;
  /** Что в записи послужило поводом — с числами, чтобы можно было перепроверить. */
  readonly evidence: string;
  readonly changes: readonly ConfigChange[];
  /** Что должно измениться, если гипотеза верна. */
  readonly expect: string;
  /** Чем за это платят. */
  readonly risk: string;
  readonly confidence: Confidence;
}

export interface RecommendationContext {
  readonly statistics: FrameStatistics;
  readonly correlation: CorrelationReport;
  readonly network: NetworkQuality;
  /** Конфиг игры, если он есть: повторять уже сделанное незачем. */
  readonly config: GameConfig | null;
  /**
   * Частота монитора.
   *
   * Именно она, а не текущий ритм игры, задаёт потолок. Ритм 64 кадра на
   * 60-герцевом экране — это и есть причина промахов: считать потолок от него
   * значило бы посоветовать 63 и ничего не изменить.
   */
  readonly displayHz: number | null;
}

/** Насколько ниже развёртки ставить потолок кадров. */
const CAP_MARGIN = 1;

/** Доля времени в рваном ритме, ниже которой трогать потолок не за чем. */
const PACING_WORTH_FIXING = 0.05;

export function recommend(context: RecommendationContext): readonly Recommendation[] {
  return [
    ...frameCap(context),
    ...notConfigProblems(context),
    ...deviceRelief(context),
    ...presentMode(context),
  ];
}

/**
 * Потолок кадров.
 *
 * Самая частая и самая проверяемая рекомендация: если игра промахивается мимо
 * развёртки, потолок чуть ниже неё убирает гонку с дедлайном.
 */
function frameCap(context: RecommendationContext): Recommendation[] {
  const { pacing } = context.statistics;
  if (pacing.timeShareInLongFrames < PACING_WORTH_FIXING) return [];

  const refreshHz = context.displayHz ?? pacing.nearestCommonHz;
  if (refreshHz === null) {
    // Не зная частоты экрана, назвать число нельзя: советовать потолок «около
    // текущего ритма» бессмысленно — именно он и промахивается.
    return [
      {
        kind: 'frame-cap',
        title: 'Похоже на промахи мимо развёртки',
        evidence:
          `${(pacing.timeShareInLongFrames * 100).toFixed(0)}% времени записи ушло в ` +
          `кадры кратно длиннее обычного при ритме ${pacing.impliedHz.toFixed(0)} в секунду.`,
        changes: [],
        expect:
          'Поставьте fps_max на единицу ниже частоты монитора и запишите ещё раз. ' +
          'Частоту показывает раздел «Аудит».',
        risk: '',
        confidence: 'likely',
      },
    ];
  }

  const target = Math.max(refreshHz - CAP_MARGIN, 30);
  const current = context.config === null ? null : findSetting(context.config, 'fps_max');
  // Потолок уже стоит примерно там, куда мы бы его поставили — советовать нечего.
  if (current !== null && current !== undefined && Number(current.value) === target) {
    return [];
  }

  return [
    {
      kind: 'frame-cap',
      title: `Ограничить кадры до ${target}`,
      evidence:
        `${(pacing.timeShareInLongFrames * 100).toFixed(0)}% времени записи ушло в кадры ` +
        `кратно длиннее обычного: игра идёт в ритме ${pacing.impliedHz.toFixed(0)} кадров ` +
        `в секунду при развёртке ${refreshHz} Гц, то есть выдаёт больше, чем экран ` +
        'успевает показать.',
      changes: [
        {
          cvar: 'fps_max',
          value: String(target),
          why: 'кадр перестаёт гнаться за развёрткой и промахиваться мимо неё',
        },
      ],
      expect: 'Доля времени в рваном ритме должна упасть. Средний FPS при этом снизится — это цена, а не провал.',
      risk: 'Инпут-лаг может вырасти на несколько миллисекунд: кадр дольше ждёт своей очереди.',
      confidence: 'measured',
    },
  ];
}

/**
 * Случаи, где конфиг бесполезен.
 *
 * Важнее остальных рекомендаций вместе взятых: человек, которому предложили
 * крутить тени при перегреве, будет крутить их до посинения.
 */
function notConfigProblems(context: RecommendationContext): Recommendation[] {
  const found: Recommendation[] = [];

  const throttling = context.correlation.tally.find((cause) => cause.kind === 'throttling');
  if (throttling !== undefined) {
    found.push({
      kind: 'not-config',
      title: 'Настройками это не лечится: видеокарта сбрасывает частоты',
      evidence: `${throttling.count} статтеров совпали с сообщением драйвера о троттлинге.`,
      changes: [],
      expect:
        'Смысл имеет охлаждение и ограничение кадров, а не качество картинки: ' +
        'снизив нагрузку, вы отодвинете перегрев, но не устраните его.',
      risk: '',
      confidence: 'measured',
    });
  }

  if (context.network.severity !== 'ok') {
    found.push({
      kind: 'not-config',
      title: 'Настройками это не лечится: дело в канале',
      evidence: context.network.summary,
      changes: [],
      expect: 'Кадры и настройки графики к сетевым рывкам отношения не имеют.',
      risk: '',
      confidence: 'measured',
    });
  }

  return found;
}

/** Настройки, снимающие работу с процессора: частицы и живое окружение. */
const CPU_RELIEF: readonly ConfigChange[] = [
  { cvar: 'cl_particle_fallback_base', value: '4', why: 'раньше упрощать частицы' },
  { cvar: 'cl_particle_fallback_multiplier', value: '4', why: 'агрессивнее упрощать частицы' },
  { cvar: 'dota_allow_clientside_particles', value: '0', why: 'снять расчёт частиц с клиента' },
  { cvar: 'dota_ambient_creatures', value: '0', why: 'убрать зверьков на карте' },
  { cvar: 'dota_ambient_cloth', value: '0', why: 'убрать колыхание ткани' },
  { cvar: 'r_dota_allow_wind_on_trees', value: '0', why: 'убрать ветер в деревьях' },
];

/** Настройки, снимающие работу с видеокарты: тени и освещение. */
const GPU_RELIEF: readonly ConfigChange[] = [
  { cvar: 'cl_globallight_shadow_mode', value: '0', why: 'самая дорогая часть кадра — тени' },
  { cvar: 'r_ssao', value: '0', why: 'затенение в углах' },
  { cvar: 'r_deferred_specular', value: '0', why: 'блики на поверхностях' },
  { cvar: 'r_dota_normal_maps', value: '0', why: 'рельеф текстур' },
  { cvar: 'dota_cheap_water', value: '1', why: 'упрощённая вода' },
];

/**
 * Снять работу с того устройства, в которое упёрлись.
 *
 * Предлагаем только то, чего в конфиге ещё нет: советовать сделанное — верный
 * способ, чтобы человек перестал читать рекомендации вовсе.
 */
function deviceRelief(context: RecommendationContext): Recommendation[] {
  const { bottleneck } = context.statistics;
  if (bottleneck.kind !== 'cpu' && bottleneck.kind !== 'gpu') return [];

  const onCpu = bottleneck.kind === 'cpu';
  const candidates = onCpu ? CPU_RELIEF : GPU_RELIEF;
  const changes = candidates.filter((change) => !alreadySet(context.config, change));

  if (changes.length === 0) {
    return [
      {
        kind: onCpu ? 'cpu-relief' : 'gpu-relief',
        title: onCpu
          ? 'По процессору выжато всё, что даёт конфиг'
          : 'По видеокарте выжато всё, что даёт конфиг',
        evidence: bottleneck.explanation,
        changes: [],
        expect:
          'Дальше помогает только меньшее разрешение, другое железо или ' +
          'ограничение кадров — но не настройки качества.',
        risk: '',
        confidence: 'measured',
      },
    ];
  }

  return [
    {
      kind: onCpu ? 'cpu-relief' : 'gpu-relief',
      title: onCpu ? 'Снять работу с процессора' : 'Снять работу с видеокарты',
      evidence: bottleneck.explanation,
      changes,
      expect: onCpu
        ? 'p99 времени кадра должен снизиться, а доля процессора в кадре — упасть.'
        : 'p99 времени кадра должен снизиться, а доля видеокарты в кадре — упасть.',
      risk: onCpu
        ? 'Эффекты станут беднее: меньше частиц, неподвижное окружение.'
        : 'Картинка станет плоской: без теней, бликов и рельефа.',
      confidence: 'measured',
    },
  ];
}

/**
 * Смена режима вывода рядом со статтером.
 *
 * Конфигом не решается: это настройки Windows, и они уже проверяются аудитом.
 */
function presentMode(context: RecommendationContext): Recommendation[] {
  const found = context.correlation.tally.find((cause) => cause.kind === 'present-mode');
  if (found === undefined) return [];

  return [
    {
      kind: 'present-mode',
      title: 'Рядом со статтерами менялся режим вывода',
      evidence: `${found.count} статтеров совпали со сменой режима вывода.`,
      changes: [],
      expect:
        'Смотрите в аудите пункты про MPO и оптимизации полноэкранного режима: ' +
        'это настройки Windows, а не игры.',
      risk: '',
      confidence: 'likely',
    },
  ];
}

function alreadySet(config: GameConfig | null, change: ConfigChange): boolean {
  if (config === null) return false;
  const setting = findSetting(config, change.cvar);
  return setting !== undefined && setting.value === change.value;
}
