import { describe, expect, it } from 'vitest';
import { analyzeNetworkQuality } from '../../src/domain/telemetry/network-quality.ts';
import type { NetworkProbe, SensorSample } from '../../src/domain/telemetry/sensor-sample.ts';

function sample(probes: readonly NetworkProbe[]): SensorSample {
  return {
    capturedAt: '2026-09-08T00:00:00Z',
    qpcTimestamp: 0,
    qpcFrequency: 10_000_000,
    gpus: [],
    cpu: null,
    network: probes,
    errors: [],
  };
}

function probe(roundTripMs: number | null, label = 'шлюз'): NetworkProbe {
  return {
    target: label === 'шлюз' ? '192.168.1.1' : '1.1.1.1',
    label,
    roundTripMs,
    success: roundTripMs !== null,
    status: roundTripMs === null ? 'TimedOut' : null,
  };
}

/** Последовательность замеров одного узла. */
function trace(roundTrips: readonly (number | null)[], label = 'шлюз'): SensorSample[] {
  return roundTrips.map((value) => sample([probe(value, label)]));
}

describe('analyzeNetworkQuality', () => {
  it('называет ровный канал ровным', () => {
    const quality = analyzeNetworkQuality(trace([3, 3, 4, 3, 3, 4, 3, 3]));

    expect(quality.severity).toBe('ok');
    expect(quality.summary).toContain('не сетевые');
  });

  it('ловит дрожание задержки', () => {
    // Средняя задержка приличная, но скачет от замера к замеру — именно это
    // ощущается как телепортация, а не абсолютная величина.
    const quality = analyzeNetworkQuality(trace([5, 60, 5, 70, 6, 80, 5, 65]));

    expect(quality.severity).toBe('bad');
    expect(quality.targets[0]?.jitterMs).toBeGreaterThan(30);
    expect(quality.summary).toContain('дрожание задержки');
  });

  it('не путает высокую, но ровную задержку с проблемой', () => {
    // 120 мс до сервера — это далеко, но играбельно и стабильно.
    const quality = analyzeNetworkQuality(trace([120, 121, 120, 122, 121, 120]));

    expect(quality.severity).toBe('ok');
    expect(quality.targets[0]?.medianMs).toBeCloseTo(120.5, 0);
  });

  it('считает потери отдельно от задержки', () => {
    const quality = analyzeNetworkQuality(trace([4, null, 4, null, 4, 4, 4, 4, 4, 4]));

    expect(quality.targets[0]?.lossShare).toBeCloseTo(0.2, 2);
    expect(quality.severity).toBe('bad');
    expect(quality.summary).toContain('потери');
  });

  it('не считает потерянный пакет нулевой задержкой', () => {
    const quality = analyzeNetworkQuality(trace([null, null, null, null, null, null]));

    expect(quality.targets[0]?.medianMs).toBeNull();
    expect(quality.targets[0]?.lossShare).toBe(1);
  });

  it('разделяет узлы: канал до роутера и до интернета — разные вещи', () => {
    const samples = [0, 1, 2, 3, 4, 5].map((index) =>
      sample([
        probe(3, 'шлюз'),
        probe(index % 2 === 0 ? 20 : 90, 'интернет'),
      ]),
    );

    const quality = analyzeNetworkQuality(samples);
    const gateway = quality.targets.find((target) => target.label === 'шлюз');
    const internet = quality.targets.find((target) => target.label === 'интернет');

    expect(gateway?.severity).toBe('ok');
    expect(internet?.severity).toBe('bad');
    // Общая оценка — по худшему: канал не лучше своего слабого звена.
    expect(quality.severity).toBe('bad');
  });

  it('говорит «не измерялась», когда замеров сети не было', () => {
    const quality = analyzeNetworkQuality([sample([])]);

    expect(quality.measured).toBe(false);
    expect(quality.summary).toContain('не измерялась');
  });

  it('отказывается судить по паре замеров', () => {
    expect(analyzeNetworkQuality(trace([3, 4])).measured).toBe(false);
  });
});
