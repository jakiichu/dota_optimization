import { describe, expect, it } from 'vitest';
import { toCaptureView } from '../../src/adapters/http/capture.view.ts';
import { computeFrameStatistics } from '../../src/domain/telemetry/frame-metrics.ts';
import { correlateStutters } from '../../src/domain/telemetry/stutter-correlation.ts';
import type { FrameCapture, FrameSample } from '../../src/domain/telemetry/frame-sample.ts';
import { frameTrace } from '../support/frame-builder.ts';

interface FrameOptions {
  readonly cpuBusyMs?: number;
  readonly gpuBusyMs?: number;
}

function capture(frameTimes: readonly number[], options: FrameOptions = {}): FrameCapture {
  const frames: FrameSample[] = frameTrace(frameTimes, () => ({
    cpuBusyMs: options.cpuBusyMs ?? null,
    gpuBusyMs: options.gpuBusyMs ?? null,
  }));

  return {
    applicationName: 'dota2.exe',
    processId: 1234,
    frames,
    availableColumns: ['FrameTime'],
  };
}

function steady(frameTimeMs: number, count: number): number[] {
  return new Array<number>(count).fill(frameTimeMs);
}

function toView(frames: FrameCapture) {
  const statistics = computeFrameStatistics(frames.frames);
  return toCaptureView({
    capture: frames,
    statistics,
    correlation: correlateStutters(frames.frames, statistics.stutters, []),
    sensorSampleCount: 0,
  });
}

describe('toCaptureView', () => {
  it('отдаёт все кадры без прореживания', () => {
    // Прореживание стёрло бы одиночные выбросы — то, ради чего запись делается.
    const view = toView(capture(steady(8, 5000)));

    expect(view.series.time).toHaveLength(5000);
    expect(view.series.frameTimeMs).toHaveLength(5000);
  });

  it('оставляет значение только у статтеров, остальное — разрывы', () => {
    const view = toView(capture([...steady(8, 30), 50, ...steady(8, 30)]));

    const marked = view.series.stutterMs.filter((value) => value !== null);

    expect(marked).toEqual([50]);
    expect(view.series.stutterMs).toHaveLength(61);
  });

  it('не отдаёт линию CPU и GPU, если этих метрик в записи не было', () => {
    const view = toView(capture(steady(8, 10)));

    // Именно null, а не массив нулей: иначе интерфейс нарисует ровную линию по
    // нулю и человек решит, что GPU простаивал.
    expect(view.series.gpuBusyMs).toBeNull();
    expect(view.series.cpuBusyMs).toBeNull();
  });

  it('отдаёт линии CPU и GPU, когда метрики есть', () => {
    const view = toView(capture(steady(10, 10), { cpuBusyMs: 4, gpuBusyMs: 9.8 }));

    expect(view.series.gpuBusyMs).toHaveLength(10);
    expect(view.bottleneck.kind).toBe('gpu');
  });

  it('сортирует худшие кадры по длительности, а не по времени', () => {
    const view = toView(capture([...steady(8, 25), 40, ...steady(8, 25), 90, ...steady(8, 25)]));

    expect(view.worstStutters[0]?.frameTimeMs).toBe(90);
    expect(view.worstStutters[1]?.frameTimeMs).toBe(40);
  });
});
