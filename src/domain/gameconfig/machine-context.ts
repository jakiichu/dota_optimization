import type { GameConfig } from './game-config.ts';

/**
 * Что известно о машине на момент разбора записи.
 *
 * Рекомендациям нужно ровно две вещи снаружи: что уже сделано в конфиге и на
 * какой частоте работает экран. Без первого они повторяли бы сделанное, без
 * второго считали бы потолок кадров от текущего ритма игры — от того самого
 * числа, которое и промахивается мимо развёртки.
 *
 * Тип доменный, хотя собирают его в инфраструктуре: это описание предметной
 * области, а не способ её получить.
 */
export interface MachineContext {
  readonly config: GameConfig | null;
  readonly displayHz: number | null;
}

export const UNKNOWN_MACHINE: MachineContext = { config: null, displayHz: null };
