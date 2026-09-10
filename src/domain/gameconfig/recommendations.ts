import type { CpuLoadProfile } from '../telemetry/cpu-load.ts';
import type { FrameStatistics } from '../telemetry/frame-metrics.ts';
import type { NetworkQuality } from '../telemetry/network-quality.ts';
import type { CorrelationReport } from '../telemetry/stutter-correlation.ts';
import { findSetting, type GameConfig } from './game-config.ts';
import type { Prediction } from './hypothesis.ts';

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
  /**
   * То же предсказание, но в числах — чтобы его можно было проверить.
   *
   * `null` там, где менять нечего: у рекомендаций вида «настройками это не
   * лечится» проверять после правки просто нечего. Предсказание есть ровно у
   * тех, у кого есть `changes`.
   */
  readonly prediction: Prediction | null;
  /** Чем за это платят. */
  readonly risk: string;
  readonly confidence: Confidence;
}

export interface RecommendationContext {
  readonly statistics: FrameStatistics;
  readonly correlation: CorrelationReport;
  readonly network: NetworkQuality;
  /** Что было с процессором: сброс частот настройками графики не лечится. */
  readonly cpuLoad: CpuLoadProfile;
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
        title: 'Похоже, кадры не попадают в обновление экрана',
        evidence:
          `${(pacing.timeShareInLongFrames * 100).toFixed(0)}% времени записи заняли кадры, ` +
          'которые длились ровно вдвое дольше остальных. Так бывает, когда игра не ' +
          'успевает к моменту обновления экрана и кадр ждёт следующего. Игра шла в ' +
          `ритме ${pacing.impliedHz.toFixed(0)} кадров в секунду, а частоту вашего экрана ` +
          'мы прочитать не смогли.',
        changes: [],
        expect:
          'Посмотрите частоту экрана в разделе «Аудит», поставьте fps_max на единицу ' +
          'ниже неё и запишите ещё раз. Доля таких кадров должна упасть.',
        // Проверять нечего: мы не назвали числа, которое надо поставить.
        prediction: null,
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
        `${(pacing.timeShareInLongFrames * 100).toFixed(0)}% времени записи заняли кадры, ` +
        `которые длились ровно вдвое дольше остальных. Игра выдаёт ${pacing.impliedHz.toFixed(0)} ` +
        `кадров в секунду, а экран показывает ${refreshHz} — лишние кадры не успевают к ` +
        'обновлению экрана и ждут следующего.',
      changes: [
        {
          cvar: 'fps_max',
          value: String(target),
          why: 'кадр перестаёт гнаться за развёрткой и промахиваться мимо неё',
        },
      ],
      expect:
        'Запишите ещё раз в той же сцене: доля времени в рваном ритме должна упасть. ' +
        'Средний FPS при этом снизится — так и должно быть, это цена, а не провал.',
      prediction: { metric: 'pacing', direction: 'down', cost: 'fps' },
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
      title: 'Настройками графики это не лечится: видеокарта сбрасывает частоты',
      evidence:
        `${throttling.count} рывков совпали с моментом, когда драйвер сам сообщил о ` +
        'сбросе частот — обычно из-за нагрева или упора в предел питания.',
      changes: [],
      expect:
        'Смотреть надо в сторону охлаждения и ограничения кадров, а не качества ' +
        'картинки: снизив нагрузку, вы отодвинете перегрев, но не устраните его.',
      prediction: null,
      risk: '',
      confidence: 'measured',
    });
  }

  // Сброс частот процессора — то же по сути, что троттлинг видеокарты, и
  // молчать о нём вдвойне обидно: на ноутбуке он случается чаще.
  if (context.cpuLoad.throttled && context.cpuLoad.performancePercent !== null) {
    found.push({
      kind: 'not-config',
      title: 'Настройками графики это не лечится: процессор сбрасывает частоты',
      evidence:
        `Процессор шёл на ${context.cpuLoad.performancePercent.toFixed(0)}% от базовой ` +
        'частоты — он не тянул даже её. Обычно это нагрев, предел питания или ' +
        'схема электропитания.',
      changes: [],
      expect:
        'Смотрите охлаждение, питание и схему электропитания в разделе «Аудит». ' +
        'Снижение качества картинки отодвинет перегрев, но не устранит его.',
      risk: '',
      confidence: 'measured',
      prediction: null,
    });
  }

  if (context.network.severity !== 'ok') {
    found.push({
      kind: 'not-config',
      title: 'Настройками графики это не лечится: дело в сети',
      evidence: `${context.network.summary} Картинка дёргается не из-за кадров, а из-за связи.`,
      changes: [],
      expect:
        'Проверять надо канал: провод вместо Wi-Fi, другой сервер, отключённый ' +
        'прокси. Настройки графики на это не влияют вовсе.',
      prediction: null,
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
  // Упор в одно ядро — тот случай, когда снятие работы с процессора и правда
  // помогает: разгружаем именно главный поток, а не добавляем ядер.
  const singleThread = onCpu && context.cpuLoad.singleThreadBound;
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
        // Менять нечего, значит и проверять нечего.
        prediction: null,
        risk: '',
        confidence: 'measured',
      },
    ];
  }

  return [
    {
      kind: onCpu ? 'cpu-relief' : 'gpu-relief',
      title: onCpu ? 'Снять работу с процессора' : 'Снять работу с видеокарты',
      evidence: singleThread
        ? `${bottleneck.explanation} ${context.cpuLoad.summary}`
        : bottleneck.explanation,
      changes,
      expect: onCpu
        ? 'Запишите ещё раз в той же сцене: самые долгие кадры (p99) должны стать ' +
          'короче, а доля процессора в кадре — упасть.'
        : 'Запишите ещё раз в той же сцене: самые долгие кадры (p99) должны стать ' +
          'короче, а доля видеокарты в кадре — упасть.',
      // За снятие нагрузки платят качеством картинки, а его мы не меряем.
      prediction: { metric: 'frameTimeP99', direction: 'down', cost: null },
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
      title: 'Рывки совпали с переключением способа вывода на экран',
      evidence:
        `${found.count} рывков пришлись на момент, когда Windows меняла способ вывода ` +
        'картинки на экран, — а делает она это сама, без участия игры.',
      changes: [],
      expect:
        'Ищите в разделе «Аудит» пункты про MPO и оптимизации полноэкранного ' +
        'режима: лечится это настройками Windows, а не игры.',
      prediction: null,
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
