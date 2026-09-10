import { describe, expect, it } from 'vitest';
import { analyzeCpuLoad } from '../../src/domain/telemetry/cpu-load.ts';
import type { Bottleneck } from '../../src/domain/telemetry/frame-metrics.ts';
import type { SensorSample } from '../../src/domain/telemetry/sensor-sample.ts';

interface Reading {
  readonly utilization?: number;
  readonly performance?: number;
  readonly threads?: number;
  /** Что сказал драйвер про сброс частот. */
  readonly reasons?: readonly string[];
  /** Был ли в замере вендорский источник, у которого вообще можно спросить. */
  readonly vendorSource?: boolean;
}

function sample(reading: Reading): SensorSample {
  const threads = reading.threads ?? 16;
  return {
    capturedAt: '2026-09-10T00:00:00Z',
    qpcTimestamp: 0,
    qpcFrequency: 1000,
    gpus: reading.vendorSource === true ? [gpu('adl')] : [gpu('pdh')],
    cpu: {
      utilizationPercent: reading.utilization ?? null,
      performancePercent: reading.performance ?? null,
      coreUtilizationPercent: new Array<number>(threads).fill(0),
      throttleReasons: reading.reasons ?? [],
    },
    network: [],
    processes: null,
    errors: [],
  };
}

function gpu(source: string): SensorSample['gpus'][number] {
  return {
    adapterName: 'адаптер',
    vendor: 'amd',
    source,
    temperatureC: null,
    coreClockMhz: null,
    memoryClockMhz: null,
    powerWatts: null,
    powerLimitWatts: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    utilizationPercent: null,
    throttleReasons: [],
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
  it('называет причину сброса частот, когда драйвер её сообщил', () => {
    // «Частота упала» — наблюдение. «Упёрлись в предел мощности» — диагноз, и
    // до появления вендорского источника сказать этого было нечем.
    const found = analyzeCpuLoad(
      [
        sample({ utilization: 90, performance: 70, reasons: ['предел мощности'], vendorSource: true }),
        sample({ utilization: 90, performance: 72, reasons: ['предел мощности'], vendorSource: true }),
      ],
      bottleneck('cpu'),
    );

    expect(found.throttled).toBe(true);
    expect(found.throttleReasons).toEqual(['предел мощности']);
    expect(found.throttleTimeShare).toBe(1);
    expect(found.summary).toContain('предел мощности');
    expect(found.summary).toContain('100%');
  });

  it('отличает «причин не было» от «спросить было некого»', () => {
    // Пустой список причин без вендорского источника значит, что вопрос никто
    // не задавал, и выдавать это за чистый результат нельзя.
    const silent = analyzeCpuLoad(
      [sample({ utilization: 90, performance: 70, vendorSource: true })],
      bottleneck('cpu'),
    );
    const nobody = analyzeCpuLoad([sample({ utilization: 90, performance: 70 })], bottleneck('cpu'));

    expect(silent.throttleTimeShare).toBe(0);
    expect(silent.summary).toContain('ни на что не жаловался');
    expect(nobody.throttleTimeShare).toBeNull();
    expect(nobody.summary).toContain('спросить некого');
  });

  it('молчит о причинах, пока частота в порядке', () => {
    // На нормальных частотах те же биты изредка мигают: это работа регулятора
    // питания, а не проблема, и объявлять её проблемой значит кричать зря.
    const found = analyzeCpuLoad(
      [sample({ utilization: 20, performance: 98, reasons: ['предел мощности'], vendorSource: true })],
      bottleneck('gpu'),
    );

    expect(found.throttled).toBe(false);
    expect(found.summary).not.toContain('предел мощности');
  });
  it('склоняет число потоков', () => {
    // Строка идёт человеку на глаза как есть, и «16 потока» читается как
    // опечатка в расчёте.
    const whole = analyzeCpuLoad([sample({ utilization: 100, threads: 16 })], bottleneck('cpu'));
    const one = analyzeCpuLoad([sample({ utilization: 6.25, threads: 16 })], bottleneck('cpu'));
    const fraction = analyzeCpuLoad([sample({ utilization: 20, threads: 16 })], bottleneck('cpu'));

    expect(whole.summary).toContain('16 потоков');
    expect(one.summary).toContain('1 поток ');
    expect(fraction.summary).toContain('3.2 потока');
  });
});
