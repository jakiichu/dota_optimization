import { describe, expect, it } from 'vitest';
import {
  CHART_POINT_BUDGET,
  framesInWindow,
  selectFramesForChart,
} from '../../src/domain/telemetry/frame-window.ts';
import { computeFrameStatistics } from '../../src/domain/telemetry/frame-metrics.ts';
import { frameTrace } from '../support/frame-builder.ts';

function steady(frameTimeMs: number, count: number): number[] {
  return new Array<number>(count).fill(frameTimeMs);
}

describe('selectFramesForChart', () => {
  it('не трогает запись, которая и так помещается', () => {
    const frames = frameTrace(steady(8, 1000));

    const selection = selectFramesForChart(frames, [], CHART_POINT_BUDGET);

    expect(selection.decimated).toBe(false);
    expect(selection.indices).toHaveLength(1000);
  });

  it('сохраняет одиночный выброс среди сотен тысяч ровных кадров', () => {
    // Ровно то, ради чего запись и делалась: кадр на 200 мс — одна точка из
    // трёхсот тысяч. Усреднение стёрло бы её, выбор — нет.
    const times = steady(8, 300_000);
    times[123_456] = 200;
    const frames = frameTrace(times);

    const selection = selectFramesForChart(frames, [], CHART_POINT_BUDGET);
    const shown = selection.indices.map((index) => frames[index]?.frameTimeMs ?? 0);

    expect(selection.decimated).toBe(true);
    expect(shown).toContain(200);
  });

  it('не выпускает ни одного значения за нарисованную огибающую', () => {
    // Проверка сильнее предыдущей: максимум записи должен быть максимумом
    // показанного, а минимум — минимумом. Иначе график врал бы о размахе.
    const times = steady(10, 120_000).map((value, index) =>
      index % 997 === 0 ? value * 4 : index % 501 === 0 ? value / 2 : value,
    );
    const frames = frameTrace(times);

    const selection = selectFramesForChart(frames, [], CHART_POINT_BUDGET);
    const shown = selection.indices.map((index) => frames[index]?.frameTimeMs ?? 0);

    expect(Math.max(...shown)).toBe(Math.max(...times));
    expect(Math.min(...shown)).toBe(Math.min(...times));
  });

  it('оставляет все статтеры до единого', () => {
    const times = steady(8, 100_000);
    for (let at = 500; at < times.length; at += 4321) times[at] = 60;
    const frames = frameTrace(times);
    const { stutters } = computeFrameStatistics(frames);

    const selection = selectFramesForChart(frames, stutters, CHART_POINT_BUDGET);
    const shown = new Set(selection.indices);

    expect(stutters.length).toBeGreaterThan(10);
    expect(stutters.every((stutter) => shown.has(stutter.frameIndex))).toBe(true);
  });

  it('укладывается в отведённое число точек', () => {
    const frames = frameTrace(steady(8, 300_000));

    const selection = selectFramesForChart(frames, [], CHART_POINT_BUDGET);

    expect(selection.indices.length).toBeLessThanOrEqual(CHART_POINT_BUDGET);
    expect(selection.sourceFrameCount).toBe(300_000);
  });

  it('отдаёт индексы по возрастанию: график рисуется слева направо', () => {
    const times = steady(8, 50_000);
    times[10_000] = 90;
    const frames = frameTrace(times);

    const selection = selectFramesForChart(frames, [], 1000);
    const sorted = [...selection.indices].sort((left, right) => left - right);

    expect(selection.indices).toEqual(sorted);
  });
});

describe('framesInWindow', () => {
  it('берёт кадры внутри отрезка времени', () => {
    const frames = frameTrace(steady(10, 1000));

    const bounds = framesInWindow(frames, { fromSeconds: 1, toSeconds: 2 });
    const inside = frames.slice(bounds.from, bounds.to);

    expect(inside[0]?.startSeconds).toBeGreaterThanOrEqual(1);
    expect(inside.at(-1)?.startSeconds).toBeLessThanOrEqual(2);
  });

  it('возвращает пусто, если в отрезке кадров нет', () => {
    const frames = frameTrace(steady(10, 100));

    const bounds = framesInWindow(frames, { fromSeconds: 500, toSeconds: 600 });

    expect(bounds.to - bounds.from).toBe(0);
  });
});
