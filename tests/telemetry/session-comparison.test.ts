import { describe, expect, it } from 'vitest';
import type { CaptureScene } from '../../src/domain/telemetry/capture-scene.ts';
import {
  compareSessions,
  type SessionSummary,
} from '../../src/domain/telemetry/session-comparison.ts';

/** По умолчанию сравниваем один и тот же повтор с одного тика — точный случай. */
const SAME_REPLAY: CaptureScene = {
  kind: 'replay',
  replayFile: '8937378139.dem',
  startTick: 40000,
  note: null,
};

interface SessionOptions {
  readonly p50?: number;
  readonly p99?: number;
  readonly p999?: number;
  readonly fps?: number;
  readonly stuttersPerMinute?: number;
  readonly stutterCount?: number;
  readonly durationSeconds?: number;
  readonly application?: string;
  readonly bottleneck?: SessionSummary['bottleneck'];
  readonly inputP99?: number;
  readonly pacingTimeShare?: number;
  readonly scene?: CaptureScene;
}

function session(id: string, options: SessionOptions = {}): SessionSummary {
  const p99 = options.p99 ?? 20;
  return {
    id,
    label: id,
    application: options.application ?? 'dota2.exe',
    capturedAt: '2026-09-08T00:00:00Z',
    durationSeconds: options.durationSeconds ?? 60,
    frameCount: 8000,
    averageFps: options.fps ?? 140,
    frameTime: {
      p50: options.p50 ?? 7,
      p95: p99 * 0.8,
      p99,
      p999: options.p999 ?? p99 * 2,
    },
    inputLatency:
      options.inputP99 === undefined
        ? null
        : { p50: options.inputP99 * 0.6, p95: options.inputP99 * 0.9, p99: options.inputP99, p999: options.inputP99 * 1.2 },
    stutterCount: options.stutterCount ?? 10,
    pacingTimeShare: options.pacingTimeShare ?? 0.05,
    stuttersPerMinute: options.stuttersPerMinute ?? 10,
    bottleneck: options.bottleneck ?? 'gpu',
    scene: options.scene ?? SAME_REPLAY,
  };
}

function metric(comparison: ReturnType<typeof compareSessions>, label: string) {
  return comparison.metrics.find((entry) => entry.label === label);
}

describe('compareSessions', () => {
  it('видит настоящее улучшение по p99 и статтерам', () => {
    const comparison = compareSessions(
      session('до', { p99: 40, stuttersPerMinute: 12, stutterCount: 12 }),
      session('после', { p99: 22, stuttersPerMinute: 3, stutterCount: 3 }),
    );

    expect(comparison.verdict).toBe('better');
    expect(comparison.summary).toContain('Стало лучше');
    expect(metric(comparison, 'p99 кадра')?.verdict).toBe('better');
  });

  it('видит ухудшение', () => {
    const comparison = compareSessions(
      session('до', { p99: 20, stuttersPerMinute: 2, stutterCount: 5 }),
      session('после', { p99: 45, stuttersPerMinute: 14, stutterCount: 14 }),
    );

    expect(comparison.verdict).toBe('worse');
    expect(comparison.summary).toContain('Стало хуже');
  });

  it('называет в итоге то, что вердикт и решило', () => {
    // Раньше фраза «стало лучше» шла рядом с выросшим p99, который на решение
    // не влиял: он остался в пределах разброса.
    const comparison = compareSessions(
      session('до', { p99: 35.7, stuttersPerMinute: 5, stutterCount: 5 }),
      session('после', { p99: 36.1, stuttersPerMinute: 2, stutterCount: 2 }),
    );

    expect(comparison.verdict).toBe('better');
    expect(comparison.summary).toContain('статтеров в минуту 5.0 → 2.0');
    expect(comparison.summary).not.toContain('35.7 → 36.1');
    expect(comparison.summary).toContain('Без изменений');
  });

  it('сравнивает ровность ритма — её ограничитель кадров и меняет', () => {
    const comparison = compareSessions(
      session('до', { pacingTimeShare: 0.2 }),
      session('после', { pacingTimeShare: 0.11 }),
    );

    const pacing = metric(comparison, 'Времени в рваном ритме');

    expect(pacing?.verdict).toBe('better');
    expect(pacing?.before).toBeCloseTo(20, 0);
  });

  it('не даёт упавшему FPS перевесить выровнявшийся ритм', () => {
    // Ограничитель кадров опускает FPS и одновременно выравнивает ритм —
    // по среднему FPS такая правка выглядела бы провалом.
    const comparison = compareSessions(
      session('до', { fps: 65, pacingTimeShare: 0.2, stuttersPerMinute: 5, stutterCount: 5 }),
      session('после', { fps: 59, pacingTimeShare: 0.08, stuttersPerMinute: 2, stutterCount: 2 }),
    );

    expect(comparison.verdict).toBe('better');
  });

  it('не выдаёт разброс за улучшение', () => {
    // 20 → 19.6 мс это 2%: две записи одной конфигурации так и различаются.
    const comparison = compareSessions(
      session('до', { p99: 20, stuttersPerMinute: 10, stutterCount: 10 }),
      session('после', { p99: 19.6, stuttersPerMinute: 9.8, stutterCount: 10 }),
    );

    expect(comparison.verdict).toBe('same');
    expect(comparison.summary).toContain('в пределах разброса');
  });

  it('требует и относительного, и абсолютного порога', () => {
    // 0.4 → 0.2 мс — целых 50%, но человеку эти доли миллисекунды безразличны.
    const comparison = compareSessions(
      session('до', { p50: 0.4, p99: 20 }),
      session('после', { p50: 0.2, p99: 20 }),
    );

    expect(metric(comparison, 'Медиана кадра')?.verdict).toBe('same');
  });

  it('не сравнивает метрику, которой нет в одной из записей', () => {
    // Подставив ноль вместо отсутствующего инпут-лага, мы получили бы
    // впечатляющее улучшение из ничего.
    const comparison = compareSessions(
      session('до', { inputP99: 50 }),
      session('после'),
    );

    expect(metric(comparison, 'Инпут-лаг p99')).toBeUndefined();
  });

  it('сравнивает инпут-лаг, когда он есть в обеих записях', () => {
    const comparison = compareSessions(
      session('до', { inputP99: 80 }),
      session('после', { inputP99: 45 }),
    );

    expect(metric(comparison, 'Инпут-лаг p99')?.verdict).toBe('better');
  });

  it('замечает смену узкого места', () => {
    const comparison = compareSessions(
      session('до', { bottleneck: 'cpu' }),
      session('после', { bottleneck: 'gpu' }),
    );

    expect(comparison.bottleneckChanged).toBe(true);
  });

  it('предупреждает о записях разной длины', () => {
    const comparison = compareSessions(
      session('до', { durationSeconds: 15 }),
      session('после', { durationSeconds: 120 }),
    );

    expect(comparison.caveats.some((text) => text.includes('разной длины'))).toBe(true);
  });

  it('предупреждает о разных приложениях', () => {
    const comparison = compareSessions(
      session('до', { application: 'dota2.exe' }),
      session('после', { application: 'cs2.exe' }),
    );

    expect(comparison.caveats.some((text) => text.includes('разных приложениях'))).toBe(true);
  });

  it('предупреждает, что по паре статтеров судить нельзя', () => {
    const comparison = compareSessions(
      session('до', { stutterCount: 1, stuttersPerMinute: 1 }),
      session('после', { stutterCount: 0, stuttersPerMinute: 0 }),
    );

    expect(comparison.caveats.some((text) => text.includes('слишком мало'))).toBe(true);
  });

  it('называет сцены обеих записей', () => {
    const comparison = compareSessions(session('до'), session('после'));

    expect(comparison.comparable).toBe(true);
    expect(comparison.caveats.some((text) => text.includes('8937378139.dem'))).toBe(true);
  });

  it('отказывается сравнивать записи из разных сцен', () => {
    // Ровно та ошибка, на которой инструмент однажды выдал разницу нагрузки за
    // результат правки настроек.
    const comparison = compareSessions(
      session('до', { scene: { kind: 'hero-demo', replayFile: null, startTick: null, note: null } }),
      session('после', { scene: { kind: 'match', replayFile: null, startTick: null, note: null } }),
    );

    expect(comparison.comparable).toBe(false);
    expect(comparison.verdict).toBe('same');
    expect(comparison.summary).toContain('сравнивать нельзя');
  });

  it('не сравнивает разные точки одного повтора', () => {
    const comparison = compareSessions(
      session('до', { scene: { ...SAME_REPLAY, startTick: 10000 } }),
      session('после'),
    );

    expect(comparison.comparable).toBe(false);
    expect(comparison.caveats.some((text) => text.includes('Разные точки повтора'))).toBe(true);
  });

  it('предупреждает, что живой матч не воспроизводится', () => {
    const live: CaptureScene = { kind: 'match', replayFile: null, startTick: null, note: null };
    const comparison = compareSessions(
      session('до', { scene: live }),
      session('после', { scene: live }),
    );

    // Считать можно, но полагаться на разницу — нет.
    expect(comparison.comparable).toBe(true);
    expect(comparison.caveats.some((text) => text.includes('воспроизвести нельзя'))).toBe(true);
  });

  it('без указанной сцены сравнение не считается возможным', () => {
    const unknown: CaptureScene = { kind: 'unknown', replayFile: null, startTick: null, note: null };
    const comparison = compareSessions(
      session('до', { scene: unknown }),
      session('после', { scene: unknown }),
    );

    expect(comparison.comparable).toBe(false);
  });

  it('не объявляет улучшением разнонаправленные изменения', () => {
    // p99 упал, но статтеров стало больше — это не «лучше», это «иначе».
    const comparison = compareSessions(
      session('до', { p99: 40, stuttersPerMinute: 2, stutterCount: 5 }),
      session('после', { p99: 20, stuttersPerMinute: 12, stutterCount: 12 }),
    );

    expect(comparison.verdict).toBe('same');
  });
});
