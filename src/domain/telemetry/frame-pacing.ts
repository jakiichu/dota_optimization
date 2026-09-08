import type { FrameSample } from './frame-sample.ts';

/**
 * Ритм кадров: ровно ли они идут.
 *
 * Отдельная метрика, потому что детектор статтеров такое не ловит. Он ищет
 * одиночные выбросы относительно локальной медианы, а когда удвоенные кадры
 * идут пачками, медиана в окне сама поднимается — и выброс перестаёт быть
 * выбросом. На живой записи Dota это дало 5 «статтеров» при том, что пятая
 * часть сессии прошла в кадрах вдвое длиннее обычного.
 *
 * Человек ощущает именно это: движение дёргается, хотя средний FPS приличный.
 */

/** Насколько кадр может отличаться от кратного интервала, чтобы считаться им. */
const MULTIPLE_TOLERANCE = 0.2;

/** Какие кратности ищем: втрое длиннее уже редкость, но встречается. */
const MULTIPLES = [2, 3] as const;

/** Кратность показываем, только если на неё пришлась заметная доля кадров. */
const MIN_MULTIPLE_SHARE = 0.02;

/** Доля времени в удлинённых кадрах, за которой это уже портит игру. */
const BAD_TIME_SHARE = 0.15;
const NOTICEABLE_TIME_SHARE = 0.05;

/** Колебание между соседними кадрами в долях базового интервала. */
const BAD_OSCILLATION = 0.3;

const MS_IN_SECOND = 1000;

/** Частоты, которые встречаются у мониторов, — для подсказки «похоже на». */
const COMMON_HZ = [60, 75, 90, 100, 120, 144, 165, 180, 240, 360] as const;

/** Насколько базовый ритм может отличаться от стандартной частоты. */
const HZ_TOLERANCE = 0.04;

export type PacingSeverity = 'ok' | 'noticeable' | 'bad';

export interface PacingMultiple {
  /** Во сколько раз кадр длиннее базового интервала. */
  readonly multiple: number;
  readonly frameCount: number;
  readonly share: number;
  readonly secondsSpent: number;
}

export interface FramePacing {
  /** Основной интервал между кадрами, мс. */
  readonly baseIntervalMs: number;
  /** Он же в герцах — с чем сравнивать частоту монитора. */
  readonly impliedHz: number;
  /** Ближайшая стандартная частота, если базовый ритм на неё похож. */
  readonly nearestCommonHz: number | null;
  readonly multiples: readonly PacingMultiple[];
  /** Сколько времени ушло в удлинённые кадры, доля записи. */
  readonly timeShareInLongFrames: number;
  /** Среднее изменение времени кадра к соседу, в долях базового интервала. */
  readonly oscillation: number;
  readonly severity: PacingSeverity;
  readonly summary: string;
}

const NO_DATA: FramePacing = {
  baseIntervalMs: 0,
  impliedHz: 0,
  nearestCommonHz: null,
  multiples: [],
  timeShareInLongFrames: 0,
  oscillation: 0,
  severity: 'ok',
  summary: 'Кадров слишком мало, чтобы судить о ритме.',
};

/** Меньше этого числа кадров — говорить о ритме нельзя. */
const MIN_FRAMES = 30;

export function analyzeFramePacing(frames: readonly FrameSample[]): FramePacing {
  if (frames.length < MIN_FRAMES) return NO_DATA;

  const frameTimes = frames.map((frame) => frame.frameTimeMs);
  const base = median(frameTimes);
  if (base <= 0) return NO_DATA;

  const totalMs = frameTimes.reduce((sum, value) => sum + value, 0);
  const multiples = findMultiples(frameTimes, base);
  const longMs = multiples.reduce((sum, entry) => sum + entry.secondsSpent, 0) * MS_IN_SECOND;
  const timeShare = totalMs === 0 ? 0 : longMs / totalMs;
  const oscillation = meanStepChange(frameTimes) / base;
  const severity = judge(timeShare, oscillation);

  return {
    baseIntervalMs: base,
    impliedHz: MS_IN_SECOND / base,
    nearestCommonHz: nearestCommonHz(MS_IN_SECOND / base),
    multiples,
    timeShareInLongFrames: timeShare,
    oscillation,
    severity,
    summary: describe(severity, base, multiples, timeShare),
  };
}

/**
 * Ищет кадры, длящиеся кратно базовому интервалу.
 *
 * Именно кратность отличает промах мимо развёртки от обычного разброса: при
 * честной просадке времена размазаны, а при промахе кадр ждёт ровно один
 * лишний интервал и садится точно на удвоенное значение.
 */
function findMultiples(
  frameTimes: readonly number[],
  base: number,
): PacingMultiple[] {
  const found: PacingMultiple[] = [];

  for (const multiple of MULTIPLES) {
    const target = base * multiple;
    const matching = frameTimes.filter(
      (value) => Math.abs(value - target) <= target * MULTIPLE_TOLERANCE,
    );

    const share = matching.length / frameTimes.length;
    if (share < MIN_MULTIPLE_SHARE) continue;

    found.push({
      multiple,
      frameCount: matching.length,
      share,
      secondsSpent: matching.reduce((sum, value) => sum + value, 0) / MS_IN_SECOND,
    });
  }

  return found;
}

/** Средняя разница между соседними кадрами: ровный ритм даёт около нуля. */
function meanStepChange(frameTimes: readonly number[]): number {
  if (frameTimes.length < 2) return 0;

  let total = 0;
  for (let index = 1; index < frameTimes.length; index += 1) {
    total += Math.abs((frameTimes[index] ?? 0) - (frameTimes[index - 1] ?? 0));
  }
  return total / (frameTimes.length - 1);
}

function judge(timeShare: number, oscillation: number): PacingSeverity {
  if (timeShare >= BAD_TIME_SHARE || oscillation >= BAD_OSCILLATION) return 'bad';
  if (timeShare >= NOTICEABLE_TIME_SHARE) return 'noticeable';
  return 'ok';
}

function describe(
  severity: PacingSeverity,
  base: number,
  multiples: readonly PacingMultiple[],
  timeShare: number,
): string {
  const rhythm = `Базовый ритм ${base.toFixed(1)} мс (${(MS_IN_SECOND / base).toFixed(0)} кадров в секунду)`;

  if (multiples.length === 0) {
    return `${rhythm}. Кадры идут ровно.`;
  }

  const doubled = multiples
    .map(
      (entry) =>
        `${(entry.share * 100).toFixed(1)}% кадров длятся в ${entry.multiple} раза дольше`,
    )
    .join(', ');
  const lost = `${(timeShare * 100).toFixed(0)}% времени записи ушло в такие кадры`;

  if (severity === 'ok') {
    return `${rhythm}. ${doubled}, но на них пришлось немного времени.`;
  }

  return (
    `${rhythm}, но ${doubled} — ${lost}. ` +
    'Кадр не успевает к развёртке и ждёт целый лишний интервал; ' +
    'это ощущается как рывки при приличном среднем FPS.'
  );
}

function nearestCommonHz(hz: number): number | null {
  for (const candidate of COMMON_HZ) {
    if (Math.abs(hz - candidate) / candidate <= HZ_TOLERANCE) return candidate;
  }
  return null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
