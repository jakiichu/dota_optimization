import type { FrameSample } from './frame-sample.ts';
import type { Stutter } from './frame-metrics.ts';

/**
 * Какие кадры показать на графике, когда их сотни тысяч.
 *
 * Правило «не прореживаем» писалось для минутной записи и защищало конкретную
 * вещь: одиночный кадр на 200 мс — это одна точка из двенадцати тысяч, и первое
 * же **усреднение** её сотрёт. Возражение было против усреднения, а не против
 * выбора точек.
 *
 * Поэтому здесь ничего не считается. Из каждого окна берутся два настоящих
 * кадра — самый короткий и самый длинный, с их настоящим временем и настоящими
 * значениями. Пик остаётся ровно там, где был, и остаётся двухсотмиллисекундным.
 * Ни одно значение записи не выходит за нарисованную огибающую.
 *
 * Сверх того принудительно включаются все статтеры: они и есть то, ради чего
 * запись делалась, и терять их нельзя даже теоретически.
 */

export interface FrameSelection {
  /** Индексы кадров по возрастанию. */
  readonly indices: readonly number[];
  /** Пришлось ли выбирать. `false` — показаны все кадры записи. */
  readonly decimated: boolean;
  /** Сколько кадров стоит за этими точками. */
  readonly sourceFrameCount: number;
}

/**
 * Сколько точек отдаём в интерфейс.
 *
 * Двенадцать тысяч — это минутная запись при двухстах кадрах, то есть ровно тот
 * объём, который uPlot и браузер уже переваривали без нареканий.
 */
export const CHART_POINT_BUDGET = 12_000;

export function selectFramesForChart(
  frames: readonly FrameSample[],
  stutters: readonly Stutter[],
  budget: number = CHART_POINT_BUDGET,
): FrameSelection {
  const all = { sourceFrameCount: frames.length, decimated: false };

  if (frames.length <= budget) {
    return { ...all, indices: frames.map((_, index) => index) };
  }

  // Из окна берём два кадра, поэтому окон вдвое меньше, чем точек.
  const buckets = Math.max(Math.floor(budget / 2), 1);
  const perBucket = frames.length / buckets;

  const chosen = new Set<number>();
  for (const stutter of stutters) {
    if (stutter.frameIndex >= 0 && stutter.frameIndex < frames.length) {
      chosen.add(stutter.frameIndex);
    }
  }

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor(bucket * perBucket);
    const to = Math.min(Math.floor((bucket + 1) * perBucket), frames.length);
    if (from >= to) continue;

    let lowest = from;
    let highest = from;
    for (let index = from + 1; index < to; index += 1) {
      const value = frames[index]?.frameTimeMs ?? 0;
      if (value < (frames[lowest]?.frameTimeMs ?? 0)) lowest = index;
      if (value > (frames[highest]?.frameTimeMs ?? 0)) highest = index;
    }
    chosen.add(lowest);
    chosen.add(highest);
  }

  return {
    sourceFrameCount: frames.length,
    decimated: true,
    indices: [...chosen].sort((left, right) => left - right),
  };
}

export interface FrameWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
}

/**
 * Кадры внутри окна времени.
 *
 * Нужно для увеличения: приблизив кусок часовой записи, человек должен увидеть
 * его целиком, кадр за кадром, а не ту же огибающую крупнее.
 */
export function framesInWindow(
  frames: readonly FrameSample[],
  window: FrameWindow,
): { readonly from: number; readonly to: number } {
  let from = 0;
  while (from < frames.length && (frames[from]?.startSeconds ?? 0) < window.fromSeconds) {
    from += 1;
  }

  let to = from;
  while (to < frames.length && (frames[to]?.startSeconds ?? 0) <= window.toSeconds) {
    to += 1;
  }

  return { from, to };
}
