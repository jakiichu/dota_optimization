import type { ReplayFile } from './models.ts';

/**
 * Перевод тиков во время и обратно.
 *
 * Появилось из простого вопроса, на который экран не отвечал: «а 5000 тиков —
 * это сколько?». Пока поле спрашивает голое число, точку в матче нельзя
 * выбрать — можно только угадать и полчаса смотреть на стадию драфта.
 *
 * Частота берётся из самого повтора: файл сообщает и тики, и секунды. Зашитая
 * тридцатка стоит запасным вариантом и только для файлов, длину которых
 * прочитать не вышло, — однажды разойтись с игрой она всё равно может, но
 * тогда хотя бы не для всех.
 */

const FALLBACK_TICKS_PER_SECOND = 30;

export function ticksPerSecond(replay: ReplayFile | undefined): number {
  if (
    replay?.ticks == null ||
    replay.durationSeconds == null ||
    replay.durationSeconds <= 0
  ) {
    return FALLBACK_TICKS_PER_SECOND;
  }
  return replay.ticks / replay.durationSeconds;
}

export function tickToSeconds(replay: ReplayFile | undefined, tick: number): number {
  return tick / ticksPerSecond(replay);
}

export function secondsToTick(replay: ReplayFile | undefined, seconds: number): number {
  return Math.round(seconds * ticksPerSecond(replay));
}

/** `2:47`, `98:00` — минуты и секунды, как на часах повтора. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Длина повтора одной фразой. `null` — файл её не сообщил. */
export function replayLength(replay: ReplayFile | undefined): string | null {
  if (replay?.durationSeconds == null) return null;
  return clock(replay.durationSeconds);
}

/** Есть ли вообще такой тик в этом повторе. */
export function tickWithinReplay(replay: ReplayFile | undefined, tick: number): boolean {
  return replay?.ticks == null || tick <= replay.ticks;
}
