import { describe, expect, it } from 'vitest';
import { toSensorSample } from '../../src/infrastructure/sensors/sidecar-sensor.sampler.ts';

/** Ответ сайдкара на машине без NVIDIA — записан как есть с реального запуска. */
const PDH_ONLY = {
  capturedAt: '2026-09-08T10:33:00.3112688+00:00',
  qpcTimestamp: 2586938784334,
  qpcFrequency: 10000000,
  gpus: [
    {
      adapterName: 'luid_0x00000000_0x0000ED1F_phys_0',
      vendor: 'unknown',
      source: 'pdh',
      temperatureC: null,
      coreClockMhz: null,
      memoryClockMhz: null,
      powerWatts: null,
      powerLimitWatts: null,
      memoryUsedBytes: 1033580544,
      memoryTotalBytes: null,
      utilizationPercent: 19.9,
      throttleReasons: [],
    },
  ],
  errors: ['nvml: nvml.dll не найдена — драйвер NVIDIA не установлен.'],
};

describe('toSensorSample', () => {
  it('разбирает ответ сайдкара без потерь', () => {
    const sample = toSensorSample(PDH_ONLY);

    expect(sample.qpcFrequency).toBe(10_000_000);
    expect(sample.gpus).toHaveLength(1);
    expect(sample.gpus[0]?.utilizationPercent).toBe(19.9);
    expect(sample.gpus[0]?.memoryUsedBytes).toBe(1_033_580_544);
    expect(sample.errors[0]).toContain('nvml.dll');
  });

  it('сохраняет null как «не прочитали», а не превращает в ноль', () => {
    const sample = toSensorSample(PDH_ONLY);

    expect(sample.gpus[0]?.temperatureC).toBeNull();
    expect(sample.gpus[0]?.powerWatts).toBeNull();
    expect(sample.gpus[0]?.memoryTotalBytes).toBeNull();
  });

  it('приводит незнакомого вендора к unknown, а не роняет разбор', () => {
    const sample = toSensorSample({
      ...PDH_ONLY,
      gpus: [{ ...PDH_ONLY.gpus[0], vendor: 'matrox' }],
    });

    expect(sample.gpus[0]?.vendor).toBe('unknown');
  });

  it('переживает отсутствие полей целиком', () => {
    const sample = toSensorSample({});

    expect(sample.gpus).toEqual([]);
    expect(sample.errors).toEqual([]);
    expect(sample.qpcFrequency).toBe(0);
  });

  it('отказывается разбирать не-объект', () => {
    expect(() => toSensorSample('нет')).toThrow(TypeError);
  });
});
