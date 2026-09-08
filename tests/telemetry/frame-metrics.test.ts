import { describe, expect, it } from 'vitest';
import {
  classifyBottleneck,
  computeFrameStatistics,
  findStutters,
  percentile,
} from '../../src/domain/telemetry/frame-metrics.ts';
import type { FrameSample } from '../../src/domain/telemetry/frame-sample.ts';

interface FrameOptions {
  readonly cpuBusyMs?: number;
  readonly gpuBusyMs?: number;
}

/** Строит запись из времён кадров, раскладывая их по общей оси времени. */
function trace(frameTimes: readonly number[], options: FrameOptions = {}): FrameSample[] {
  let elapsed = 0;
  return frameTimes.map((frameTimeMs) => {
    const frame: FrameSample = {
      startSeconds: elapsed / 1000,
      frameTimeMs,
      cpuBusyMs: options.cpuBusyMs ?? null,
      gpuBusyMs: options.gpuBusyMs ?? null,
      displayLatencyMs: null,
      presentMode: null,
      dropped: null,
    };
    elapsed += frameTimeMs;
    return frame;
  });
}

function steady(frameTimeMs: number, count: number): number[] {
  return new Array<number>(count).fill(frameTimeMs);
}

describe('percentile', () => {
  it('возвращает настоящее значение кадра, а не интерполяцию', () => {
    const sorted = [1, 2, 3, 4, 100];

    expect(percentile(sorted, 0.5)).toBe(3);
    expect(percentile(sorted, 0.99)).toBe(100);
  });

  it('не падает на пустой записи', () => {
    expect(percentile([], 0.99)).toBe(0);
  });
});

describe('findStutters', () => {
  it('находит одиночный фриз среди ровных кадров', () => {
    const frames = trace([...steady(8, 30), 50, ...steady(8, 30)]);

    const stutters = findStutters(frames);

    expect(stutters).toHaveLength(1);
    expect(stutters[0]?.frameTimeMs).toBe(50);
    expect(stutters[0]?.baselineMs).toBe(8);
  });

  it('не считает статтером мелкий скачок на высоком FPS', () => {
    // 2 → 5 мс это втрое, но человек такого не замечает: разница 3 мс.
    const frames = trace([...steady(2, 30), 5, ...steady(2, 30)]);

    expect(findStutters(frames)).toHaveLength(0);
  });

  it('не считает статтерами плавную смену частоты кадров', () => {
    // Переход из меню (200 FPS) в бой (60 FPS) — не сотня фризов.
    const frames = trace([...steady(5, 60), ...steady(16.7, 60)]);

    expect(findStutters(frames)).toHaveLength(0);
  });

  it('не даёт длинному фризу поднять собственную норму', () => {
    // Кадр исключён из своего окна, иначе чем хуже фриз, тем менее он заметен.
    const frames = trace([...steady(8, 20), 400, ...steady(8, 20)]);

    const stutters = findStutters(frames);

    expect(stutters).toHaveLength(1);
    expect(stutters[0]?.ratio).toBeCloseTo(50, 0);
  });
});

describe('computeFrameStatistics', () => {
  it('считает длительность и средний FPS по времени кадров', () => {
    const stats = computeFrameStatistics(trace(steady(10, 100)));

    expect(stats.frameCount).toBe(100);
    expect(stats.durationSeconds).toBeCloseTo(1, 5);
    expect(stats.averageFps).toBeCloseTo(100, 5);
  });

  it('различает записи с одинаковым средним FPS, но разной ровностью', () => {
    const smooth = computeFrameStatistics(trace(steady(10, 100)));
    const choppy = computeFrameStatistics(
      trace([...steady(5, 90), ...steady(55, 10)]),
    );

    // Средний FPS почти одинаковый, а хвост распределения — нет.
    expect(choppy.averageFps).toBeCloseTo(smooth.averageFps, 0);
    expect(choppy.frameTime.p99).toBeGreaterThan(smooth.frameTime.p99 * 5);
  });

  it('приводит число статтеров к минуте записи', () => {
    const stats = computeFrameStatistics(trace([...steady(10, 100), 60, ...steady(10, 100)]));

    expect(stats.stutters).toHaveLength(1);
    expect(stats.stuttersPerMinute).toBeCloseTo(29, 0);
  });

  it('возвращает пустую статистику, а не падает, на записи без кадров', () => {
    const stats = computeFrameStatistics([]);

    expect(stats.frameCount).toBe(0);
    expect(stats.bottleneck.kind).toBe('unknown');
  });
});

describe('classifyBottleneck', () => {
  const percentiles = { p50: 10, p95: 10, p99: 10, p999: 10 };

  it('видит упор в видеокарту', () => {
    const frames = trace(steady(10, 50), { gpuBusyMs: 9.9, cpuBusyMs: 3 });

    const bottleneck = classifyBottleneck(frames, percentiles);

    expect(bottleneck.kind).toBe('gpu');
    expect(bottleneck.gpuBusyShare).toBeCloseTo(0.99, 2);
  });

  it('видит упор в процессор', () => {
    const frames = trace(steady(10, 50), { gpuBusyMs: 4, cpuBusyMs: 9.8 });

    expect(classifyBottleneck(frames, percentiles).kind).toBe('cpu');
  });

  it('отличает ограничитель кадров от узкого места', () => {
    // Кадры идеально ровные, железо свободно — это лимитер, а не проблема.
    const frames = trace(steady(10, 50), { gpuBusyMs: 4, cpuBusyMs: 3 });

    const bottleneck = classifyBottleneck(frames, percentiles);

    expect(bottleneck.kind).toBe('limited');
  });

  it('честно говорит «не знаю» без разбивки кадра', () => {
    const bottleneck = classifyBottleneck(trace(steady(10, 50)), percentiles);

    expect(bottleneck.kind).toBe('unknown');
    expect(bottleneck.explanation).toContain('PresentMon 2.x');
  });

  it('не выдаёт ограничитель за узкое место, когда кадры пляшут', () => {
    const jumpy = { p50: 10, p95: 20, p99: 40, p999: 60 };
    const frames = trace([...steady(10, 40), ...steady(40, 10)], {
      gpuBusyMs: 6,
      cpuBusyMs: 5,
    });

    expect(classifyBottleneck(frames, jumpy).kind).toBe('mixed');
  });
});
