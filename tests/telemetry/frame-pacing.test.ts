import { describe, expect, it } from 'vitest';
import { analyzeFramePacing } from '../../src/domain/telemetry/frame-pacing.ts';
import { frameTrace } from '../support/frame-builder.ts';

const frames = (frameTimes: readonly number[]) => frameTrace(frameTimes);

/** Ровный поток с заданной долей кадров, промахнувшихся мимо развёртки. */
function withDoubled(base: number, total: number, doubledShare: number): number[] {
  const result: number[] = [];
  const every = Math.round(1 / doubledShare);
  for (let index = 0; index < total; index += 1) {
    result.push(index % every === 0 ? base * 2 : base);
  }
  return result;
}

describe('analyzeFramePacing', () => {
  it('называет ровный поток ровным', () => {
    const pacing = analyzeFramePacing(frames(new Array<number>(600).fill(6.94)));

    expect(pacing.severity).toBe('ok');
    expect(pacing.multiples).toHaveLength(0);
    expect(pacing.summary).toContain('Кадры идут ровно');
  });

  it('находит удвоенные кадры и считает потерянное на них время', () => {
    // Каждый пятый кадр промахнулся: 20% кадров, но треть времени.
    const pacing = analyzeFramePacing(frames(withDoubled(16.6, 500, 0.2)));

    expect(pacing.severity).toBe('bad');
    expect(pacing.multiples[0]?.multiple).toBe(2);
    expect(pacing.multiples[0]?.share).toBeCloseTo(0.2, 1);
    expect(pacing.timeShareInLongFrames).toBeGreaterThan(0.3);
  });

  it('объясняет, почему средний FPS при этом выглядит прилично', () => {
    const pacing = analyzeFramePacing(frames(withDoubled(16.6, 500, 0.2)));

    expect(pacing.summary).toContain('лишний интервал');
    expect(pacing.summary).toContain('рывки');
  });

  it('узнаёт стандартную частоту развёртки в базовом ритме', () => {
    const pacing = analyzeFramePacing(frames(new Array<number>(300).fill(16.67)));

    expect(pacing.impliedHz).toBeCloseTo(60, 0);
    expect(pacing.nearestCommonHz).toBe(60);
  });

  it('не подгоняет под стандартную частоту то, что на неё не похоже', () => {
    // 23 кадра в секунду — ни на что не похоже, и врать об этом не надо.
    const pacing = analyzeFramePacing(frames(new Array<number>(300).fill(43.5)));

    expect(pacing.nearestCommonHz).toBeNull();
  });

  it('не считает проблемой стабильные 30 кадров на 60 герцах', () => {
    // Ограничитель вдвое ниже развёртки — это ровный ритм, а не судорога.
    const pacing = analyzeFramePacing(frames(new Array<number>(400).fill(33.3)));

    expect(pacing.severity).toBe('ok');
    expect(pacing.multiples).toHaveLength(0);
  });

  it('ловит дёрганый ритм даже без кратных кадров', () => {
    // Времена скачут туда-сюда: кратности нет, но играть невозможно.
    const jumpy: number[] = [];
    for (let index = 0; index < 400; index += 1) {
      jumpy.push(index % 2 === 0 ? 8 : 24);
    }

    const pacing = analyzeFramePacing(frames(jumpy));

    expect(pacing.oscillation).toBeGreaterThan(0.3);
    expect(pacing.severity).toBe('bad');
  });

  it('различает редкие промахи и постоянные', () => {
    const rare = analyzeFramePacing(frames(withDoubled(16.6, 500, 0.02)));
    const constant = analyzeFramePacing(frames(withDoubled(16.6, 500, 0.25)));

    expect(rare.severity).toBe('ok');
    expect(constant.severity).toBe('bad');
  });

  it('отказывается судить по десятку кадров', () => {
    const pacing = analyzeFramePacing(frames(new Array<number>(10).fill(16.6)));

    expect(pacing.summary).toContain('слишком мало');
  });
});
