import { describe, expect, it } from 'vitest';
import { parseGameConfig } from '../../src/domain/gameconfig/game-config.ts';
import {
  recommend,
  type RecommendationContext,
} from '../../src/domain/gameconfig/recommendations.ts';
import { computeFrameStatistics } from '../../src/domain/telemetry/frame-metrics.ts';
import { analyzeNetworkQuality } from '../../src/domain/telemetry/network-quality.ts';
import { analyzeCpuLoad } from '../../src/domain/telemetry/cpu-load.ts';
import { correlateStutters } from '../../src/domain/telemetry/stutter-correlation.ts';
import { frameTrace } from '../support/frame-builder.ts';

interface Options {
  readonly frameTimes?: readonly number[];
  readonly cpuShare?: number;
  readonly gpuShare?: number;
  readonly configLines?: readonly string[];
  readonly displayHz?: number | null;
}

function steady(frameTimeMs: number, count: number): number[] {
  return new Array<number>(count).fill(frameTimeMs);
}

/** Ровный поток с частью кадров, промахнувшихся мимо развёртки. */
function withDoubled(base: number, total: number, share: number): number[] {
  const every = Math.round(1 / share);
  return Array.from({ length: total }, (_, index) =>
    index % every === 0 ? base * 2 : base,
  );
}

function context(options: Options = {}): RecommendationContext {
  const frames = frameTrace(options.frameTimes ?? steady(16.6, 400), (frameTimeMs) => ({
    cpuBusyMs: options.cpuShare === undefined ? null : frameTimeMs * options.cpuShare,
    gpuBusyMs: options.gpuShare === undefined ? null : frameTimeMs * options.gpuShare,
  }));
  const statistics = computeFrameStatistics(frames);

  return {
    statistics,
    correlation: correlateStutters(frames, statistics.stutters, []),
    network: analyzeNetworkQuality([]),
    cpuLoad: analyzeCpuLoad([], statistics.bottleneck),
    config:
      options.configLines === undefined
        ? null
        : parseGameConfig('autoexec.cfg', options.configLines.join('\n')),
    // По умолчанию 60 Гц — экран, на котором и обнаружились промахи.
    displayHz: options.displayHz === undefined ? 60 : options.displayHz,
  };
}

function kinds(options: Options = {}): string[] {
  return recommend(context(options)).map((entry) => entry.kind);
}

describe('recommend', () => {
  it('молчит, когда придраться не к чему', () => {
    expect(kinds({ cpuShare: 0.4, gpuShare: 0.4 })).toEqual([]);
  });

  it('предлагает потолок кадров, когда ритм рваный', () => {
    const found = recommend(
      context({ frameTimes: withDoubled(16.6, 400, 0.2), cpuShare: 0.4, gpuShare: 0.4 }),
    );
    const cap = found.find((entry) => entry.kind === 'frame-cap');

    expect(cap?.changes[0]?.cvar).toBe('fps_max');
    // 59, а не 63: потолок считается от частоты экрана, а не от ритма игры —
    // именно ритм 64 на 60-герцевом экране и промахивается мимо развёртки.
    expect(Number(cap?.changes[0]?.value)).toBe(59);
  });

  it('несёт повод с числами, а не общие слова', () => {
    const found = recommend(
      context({ frameTimes: withDoubled(16.6, 400, 0.2), cpuShare: 0.4, gpuShare: 0.4 }),
    );

    expect(found[0]?.evidence).toMatch(/\d+% времени записи/);
  });

  it('предсказывает, что именно должно измениться', () => {
    // Без предсказания рекомендацию нельзя опровергнуть — это и отличает её
    // от совета из интернета.
    const found = recommend(
      context({ frameTimes: withDoubled(16.6, 400, 0.2), cpuShare: 0.4, gpuShare: 0.4 }),
    );

    expect(found[0]?.expect).toContain('рваном ритме');
    expect(found[0]?.risk).toContain('Инпут-лаг');
  });

  it('считает потолок от частоты экрана, а не от ритма игры', () => {
    const on144 = recommend(
      context({
        frameTimes: withDoubled(16.6, 400, 0.2),
        cpuShare: 0.4,
        gpuShare: 0.4,
        displayHz: 144,
      }),
    ).find((entry) => entry.kind === 'frame-cap');

    expect(Number(on144?.changes[0]?.value)).toBe(143);
  });

  it('не называет числа, не зная частоты экрана', () => {
    // Совет «поставь потолок около текущего ритма» бессмысленен: это и есть
    // то число, которое промахивается. Ритм 45 кадров не похож ни на одну
    // стандартную развёртку, поэтому и угадать её не выйдет.
    const found = recommend(
      context({
        frameTimes: withDoubled(22.0, 400, 0.2),
        cpuShare: 0.4,
        gpuShare: 0.4,
        displayHz: null,
      }),
    ).find((entry) => entry.kind === 'frame-cap');

    expect(found?.changes).toHaveLength(0);
    expect(found?.confidence).toBe('likely');
  });

  it('не советует потолок, который уже стоит', () => {
    const already = kinds({
      frameTimes: withDoubled(16.6, 400, 0.2),
      cpuShare: 0.4,
      gpuShare: 0.4,
      configLines: ['fps_max 59'],
    });

    expect(already).not.toContain('frame-cap');
  });

  it('при упоре в процессор предлагает снять работу с процессора', () => {
    const found = recommend(context({ cpuShare: 0.98, gpuShare: 0.2 }));
    const relief = found.find((entry) => entry.kind === 'cpu-relief');

    expect(relief?.changes.map((change) => change.cvar)).toContain('dota_ambient_creatures');
    expect(relief?.changes.map((change) => change.cvar)).not.toContain('r_ssao');
  });

  it('при упоре в видеокарту предлагает снять работу с неё', () => {
    const found = recommend(context({ cpuShare: 0.2, gpuShare: 0.98 }));
    const relief = found.find((entry) => entry.kind === 'gpu-relief');

    expect(relief?.changes.map((change) => change.cvar)).toContain('r_ssao');
  });

  it('не повторяет то, что в конфиге уже сделано', () => {
    const found = recommend(
      context({
        cpuShare: 0.98,
        gpuShare: 0.2,
        configLines: ['dota_ambient_creatures 0', 'dota_ambient_cloth 0'],
      }),
    );
    const relief = found.find((entry) => entry.kind === 'cpu-relief');

    expect(relief?.changes.map((change) => change.cvar)).not.toContain('dota_ambient_creatures');
    expect(relief?.changes.map((change) => change.cvar)).toContain('r_dota_allow_wind_on_trees');
  });

  it('честно говорит, когда конфигом выжато всё', () => {
    const everything = [
      'cl_particle_fallback_base 4',
      'cl_particle_fallback_multiplier 4',
      'dota_allow_clientside_particles 0',
      'dota_ambient_creatures 0',
      'dota_ambient_cloth 0',
      'r_dota_allow_wind_on_trees 0',
    ];
    const found = recommend(
      context({ cpuShare: 0.98, gpuShare: 0.2, configLines: everything }),
    );
    const relief = found.find((entry) => entry.kind === 'cpu-relief');

    expect(relief?.changes).toHaveLength(0);
    expect(relief?.title).toContain('выжато всё');
  });

  it('говорит, что троттлинг настройками не лечится', () => {
    // Человек, которому предложили крутить тени при перегреве, будет крутить
    // их до посинения.
    const frames = frameTrace([...steady(8, 30), 60, ...steady(8, 30)], (frameTimeMs) => ({
      cpuBusyMs: frameTimeMs * 0.4,
      gpuBusyMs: frameTimeMs * 0.4,
    }), 1000);
    const statistics = computeFrameStatistics(frames);
    const sensors = [
      {
        capturedAt: '2026-09-09T00:00:00Z',
        qpcTimestamp: (frames[30]?.qpcMs ?? 0) - 50,
        qpcFrequency: 1000,
        gpus: [
          {
            adapterName: 'GPU',
            vendor: 'nvidia' as const,
            source: 'nvml',
            temperatureC: 88,
            coreClockMhz: null,
            memoryClockMhz: null,
            powerWatts: null,
            powerLimitWatts: null,
            memoryUsedBytes: null,
            memoryTotalBytes: null,
            utilizationPercent: 95,
            throttleReasons: ['аппаратный троттлинг по температуре'],
          },
        ],
        cpu: null,
        network: [],
        processes: null,
        errors: [],
      },
    ];

    const found = recommend({
      statistics,
      correlation: correlateStutters(frames, statistics.stutters, sensors),
      network: analyzeNetworkQuality([]),
      cpuLoad: analyzeCpuLoad(sensors, statistics.bottleneck),
      config: null,
      displayHz: 60,
    });
    const note = found.find((entry) => entry.kind === 'not-config');

    expect(note?.title).toContain('не лечится');
    expect(note?.changes).toHaveLength(0);
  });

  it('говорит, что сетевые рывки настройками не лечатся', () => {
    const jittery = [5, 60, 5, 70, 6, 80, 5, 65].map((roundTripMs) => ({
      capturedAt: '2026-09-09T00:00:00Z',
      qpcTimestamp: 0,
      qpcFrequency: 1000,
      gpus: [],
      cpu: null,
      network: [
        {
          target: '192.168.1.1',
          label: 'шлюз',
          roundTripMs,
          success: true,
          status: null,
        },
      ],
      processes: null,
      errors: [],
    }));

    const found = recommend({ ...context({ cpuShare: 0.4, gpuShare: 0.4 }), network: analyzeNetworkQuality(jittery) });
    const note = found.find((entry) => entry.kind === 'not-config');

    expect(note?.title).toContain('дело в сети');
  });
});
