import { describe, expect, it } from 'vitest';
import { findStutters } from '../../src/domain/telemetry/frame-metrics.ts';
import type { FrameSample } from '../../src/domain/telemetry/frame-sample.ts';
import type { SensorSample } from '../../src/domain/telemetry/sensor-sample.ts';
import { frameTrace } from '../support/frame-builder.ts';
import {
  correlateStutters,
  type EvidenceKind,
} from '../../src/domain/telemetry/stutter-correlation.ts';

const QPC_FREQUENCY = 10_000_000;
/** Произвольная точка отсчёта: важно только, что она общая у кадров и сенсоров. */
const ORIGIN_MS = 5_000_000;

interface FrameOptions {
  readonly cpuBusyShare?: number;
  readonly gpuBusyShare?: number;
  readonly presentMode?: string;
  readonly dropped?: boolean;
  readonly withQpc?: boolean;
}

function buildFrames(
  frameTimes: readonly number[],
  options: FrameOptions = {},
): FrameSample[] {
  return frameTrace(
    frameTimes,
    (frameTimeMs) => ({
      cpuBusyMs:
        options.cpuBusyShare === undefined ? null : frameTimeMs * options.cpuBusyShare,
      gpuBusyMs:
        options.gpuBusyShare === undefined ? null : frameTimeMs * options.gpuBusyShare,
      presentMode: options.presentMode ?? null,
      dropped: options.dropped ?? null,
    }),
    options.withQpc === false ? null : ORIGIN_MS,
  );
}

function steady(frameTimeMs: number, count: number): number[] {
  return new Array<number>(count).fill(frameTimeMs);
}

/** Ровная запись с одним фризом в середине. */
function traceWithSpike(options: FrameOptions = {}): FrameSample[] {
  return buildFrames([...steady(8, 30), 60, ...steady(8, 30)], options);
}

function sensorSample(
  offsetMs: number,
  reading: { utilization?: number | null; memoryMib?: number; throttle?: string[] },
): SensorSample {
  return {
    capturedAt: '2026-09-08T00:00:00Z',
    qpcTimestamp: ((ORIGIN_MS + offsetMs) / 1000) * QPC_FREQUENCY,
    qpcFrequency: QPC_FREQUENCY,
    gpus: [
      {
        adapterName: 'GPU-0',
        vendor: 'nvidia',
        source: 'nvml',
        temperatureC: null,
        coreClockMhz: null,
        memoryClockMhz: null,
        powerWatts: null,
        powerLimitWatts: null,
        memoryUsedBytes:
          reading.memoryMib === undefined ? null : reading.memoryMib * 1024 * 1024,
        memoryTotalBytes: null,
        utilizationPercent: reading.utilization === undefined ? 90 : reading.utilization,
        throttleReasons: reading.throttle ?? [],
      },
    ],
    cpu: null,
    network: [],
    processes: null,
    errors: [],
  };
}

function kindsFor(report: ReturnType<typeof correlateStutters>): EvidenceKind[] {
  return report.stutters[0]?.evidence.map((item) => item.kind) ?? [];
}

function correlate(frames: FrameSample[], sensors: SensorSample[] = []) {
  return correlateStutters(frames, findStutters(frames), sensors);
}

describe('correlateStutters', () => {
  it('обвиняет GPU, когда он занял кадр целиком', () => {
    const frames = traceWithSpike({ gpuBusyShare: 0.95, cpuBusyShare: 0.2 });

    const report = correlate(frames);

    expect(kindsFor(report)).toContain('gpu-work');
    expect(report.stutters[0]?.evidence[0]?.detail).toContain('57.0 мс из 60.0 мс');
  });

  it('обвиняет CPU, когда кадр целиком занял он', () => {
    const frames = traceWithSpike({ cpuBusyShare: 0.9, gpuBusyShare: 0.2 });

    expect(kindsFor(correlate(frames))).toContain('cpu-work');
  });

  it('отдельно называет кадр, который не работал, а ждал', () => {
    // Ни CPU, ни GPU не были заняты — такое не видно ни в одном счётчике загрузки.
    const frames = traceWithSpike({ cpuBusyShare: 0.1, gpuBusyShare: 0.15 });

    const kinds = kindsFor(correlate(frames));

    expect(kinds).toContain('waiting');
    expect(kinds).not.toContain('gpu-work');
    expect(kinds).not.toContain('cpu-work');
  });

  it('замечает провал загрузки GPU перед кадром', () => {
    const frames = traceWithSpike({ cpuBusyShare: 0.1, gpuBusyShare: 0.1 });
    const spikeAt = frames[30]?.qpcMs ?? 0;
    const sensors = [
      sensorSample(0, { utilization: 92 }),
      sensorSample(spikeAt - ORIGIN_MS - 100, { utilization: 8 }),
      sensorSample(spikeAt - ORIGIN_MS + 500, { utilization: 91 }),
    ];

    const kinds = kindsFor(correlate(frames, sensors));

    expect(kinds).toContain('gpu-idle');
  });

  it('не считает провалом обычную для этой записи загрузку', () => {
    const frames = traceWithSpike({ cpuBusyShare: 0.1, gpuBusyShare: 0.1 });
    const spikeAt = (frames[30]?.qpcMs ?? 0) - ORIGIN_MS;
    const sensors = [
      sensorSample(0, { utilization: 12 }),
      sensorSample(spikeAt - 100, { utilization: 11 }),
      sensorSample(spikeAt + 500, { utilization: 12 }),
    ];

    expect(kindsFor(correlate(frames, sensors))).not.toContain('gpu-idle');
  });

  it('замечает рост видеопамяти в окне перед кадром', () => {
    const frames = traceWithSpike({ cpuBusyShare: 0.4, gpuBusyShare: 0.4 });
    const spikeAt = (frames[30]?.qpcMs ?? 0) - ORIGIN_MS;
    const sensors = [
      sensorSample(spikeAt - 150, { memoryMib: 3000 }),
      sensorSample(spikeAt - 20, { memoryMib: 3400 }),
    ];

    const kinds = kindsFor(correlate(frames, sensors));

    expect(kinds).toContain('vram-growth');
  });

  it('передаёт причину троттлинга словами вендора', () => {
    const frames = traceWithSpike({ cpuBusyShare: 0.4, gpuBusyShare: 0.4 });
    const spikeAt = (frames[30]?.qpcMs ?? 0) - ORIGIN_MS;
    const sensors = [
      sensorSample(spikeAt - 50, { throttle: ['аппаратный троттлинг по температуре'] }),
    ];

    const evidence = correlate(frames, sensors).stutters[0]?.evidence ?? [];
    const throttling = evidence.find((item) => item.kind === 'throttling');

    expect(throttling?.detail).toContain('аппаратный троттлинг по температуре');
  });

  it('не приписывает статтеру показания из будущего', () => {
    const frames = traceWithSpike({ cpuBusyShare: 0.1, gpuBusyShare: 0.1 });
    const spikeAt = (frames[30]?.qpcMs ?? 0) - ORIGIN_MS;
    // Провал загрузки случился ПОСЛЕ кадра — причиной он быть не мог.
    const sensors = [
      sensorSample(spikeAt - 500, { utilization: 90 }),
      sensorSample(spikeAt + 50, { utilization: 3 }),
    ];

    expect(kindsFor(correlate(frames, sensors))).not.toContain('gpu-idle');
  });

  it('считает, сколько статтеров пришлось на каждую причину', () => {
    const frames = buildFrames(
      [...steady(8, 25), 60, ...steady(8, 25), 70, ...steady(8, 25)],
      { gpuBusyShare: 0.95, cpuBusyShare: 0.2 },
    );

    const report = correlate(frames);

    expect(report.stutters).toHaveLength(2);
    expect(report.tally[0]).toEqual({
      kind: 'gpu-work',
      label: 'Кадр целиком занят работой GPU',
      count: 2,
    });
  });

  it('различает «причин нет» и «данных не было»', () => {
    const withoutBreakdown = correlate(traceWithSpike());

    expect(withoutBreakdown.unexplained).toBe(1);
    expect(withoutBreakdown.limitations).toContain(
      'В записи нет разбивки кадра по CPU и GPU — нужны метрики PresentMon 2.x.',
    );
    expect(withoutBreakdown.limitations).toContain(
      'Показания сенсоров за время записи не собраны.',
    );
  });

  it('сообщает, что без абсолютного времени кадры с сенсорами не свести', () => {
    const frames = traceWithSpike({ cpuBusyShare: 0.4, gpuBusyShare: 0.4, withQpc: false });

    const report = correlate(frames, [sensorSample(0, { utilization: 5 })]);

    expect(report.limitations).toContain(
      'У кадров нет абсолютного времени — сопоставить их с сенсорами нельзя.',
    );
    expect(kindsFor(report)).not.toContain('gpu-idle');
  });
});
