import { describe, expect, it } from 'vitest';
import {
  compareSessions,
  type SessionSummary,
} from '../../src/domain/telemetry/session-comparison.ts';

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
    stuttersPerMinute: options.stuttersPerMinute ?? 10,
    bottleneck: options.bottleneck ?? 'gpu',
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

  it('всегда напоминает про одинаковую сцену', () => {
    const comparison = compareSessions(session('до'), session('после'));

    expect(comparison.caveats.some((text) => text.includes('сцена была одинаковой'))).toBe(
      true,
    );
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
