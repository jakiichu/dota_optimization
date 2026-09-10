import { describe, expect, it } from 'vitest';
import { analyzeCpuLoad } from '../../src/domain/telemetry/cpu-load.ts';
import type { Bottleneck } from '../../src/domain/telemetry/frame-metrics.ts';
import type { SensorSample } from '../../src/domain/telemetry/sensor-sample.ts';

interface Reading {
  readonly utilization?: number;
  readonly performance?: number;
  readonly threads?: number;
}

function sample(reading: Reading): SensorSample {
  const threads = reading.threads ?? 16;
  return {
    capturedAt: '2026-09-10T00:00:00Z',
    qpcTimestamp: 0,
    qpcFrequency: 1000,
    gpus: [],
    cpu: {
      utilizationPercent: reading.utilization ?? null,
      performancePercent: reading.performance ?? null,
      coreUtilizationPercent: new Array<number>(threads).fill(0),
    },
    network: [],
    processes: null,
    errors: [],
  };
}

function bottleneck(kind: Bottleneck['kind']): Bottleneck {
  return { kind, gpuBusyShare: null, cpuBusyShare: null, explanation: 'кадр' };
}

describe('analyzeCpuLoad', () => {
  it('честно молчит, когда показаний не было', () => {
    const found = analyzeCpuLoad([], bottleneck('cpu'));

    expect(found.measured).toBe(false);
    expect(found.busyThreads).toBeNull();
    expect(found.singleThreadBound).toBe(false);
  });

  it('переводит проценты в занятые потоки', () => {
    // «Занято 4 потока из 16» отвечает на вопрос, поможет ли процессор с
    // бо́льшим числом ядер. «25%» — не отвечает.
    const found = analyzeCpuLoad([sample({ utilization: 25, threads: 16 })], bottleneck('cpu'));

    expect(found.busyThreads).toBe(4);
    expect(found.threadCount).toBe(16);
  });

  it('видит упор в одно ядро: занято мало потоков, а кадр держит процессор', () => {
    const found = analyzeCpuLoad(
      [sample({ utilization: 12, threads: 16 })],
      bottleneck('cpu'),
    );

    expect(found.singleThreadBound).toBe(true);
    expect(found.summary).toContain('одного ядра');
  });

  it('не называет однопоточным упор в видеокарту', () => {
    // Малая загрузка процессора при упоре в GPU — это норма, а не диагноз.
    const found = analyzeCpuLoad(
      [sample({ utilization: 12, threads: 16 })],
      bottleneck('gpu'),
    );

    expect(found.singleThreadBound).toBe(false);
  });

  it('не называет однопоточным загруженный процессор', () => {
    const found = analyzeCpuLoad(
      [sample({ utilization: 80, threads: 16 })],
      bottleneck('cpu'),
    );

    expect(found.busyThreads).toBe(12.8);
    expect(found.singleThreadBound).toBe(false);
  });

  it('замечает, что процессор не держит базовую частоту', () => {
    const found = analyzeCpuLoad(
      [sample({ utilization: 70, performance: 72 })],
      bottleneck('cpu'),
    );

    expect(found.throttled).toBe(true);
    expect(found.summary).toContain('72% от базовой');
  });

  it('не считает троттлингом разгон выше базовой', () => {
    // 186% базовой — обычное поведение современного процессора, а не поломка.
    const found = analyzeCpuLoad(
      [sample({ utilization: 26, performance: 186 })],
      bottleneck('gpu'),
    );

    expect(found.throttled).toBe(false);
  });

  it('берёт медиану, а не последний замер', () => {
    // Один провал при переключении состояний питания — не приговор.
    const found = analyzeCpuLoad(
      [
        sample({ utilization: 50, performance: 150 }),
        sample({ utilization: 50, performance: 60 }),
        sample({ utilization: 50, performance: 150 }),
      ],
      bottleneck('cpu'),
    );

    expect(found.throttled).toBe(false);
    expect(found.lowestPerformancePercent).toBe(60);
  });
});
