import { describe, expect, it } from 'vitest';
import { compareRepeatedSessions } from '../../src/domain/telemetry/repeated-comparison.ts';
import type { SessionSummary } from '../../src/domain/telemetry/session-comparison.ts';
import { EMPTY_PASSPORT } from '../../src/domain/snapshot/machine-passport.ts';

function group(prefix: string, p99s: number[]): SessionSummary[] {
  return p99s.map((p99, index) => ({
    id: `${prefix}-${index}`,
    label: `${prefix}-${index}`,
    application: 'dota2.exe',
    capturedAt: '2026-09-11T10:00:00Z',
    durationSeconds: 60,
    frameCount: 6000,
    averageFps: 100,
    frameTime: { p50: 10, p95: 12, p99, p999: 50 },
    inputLatency: null,
    stutterCount: 5,
    stuttersPerMinute: 5,
    pacingTimeShare: 0.1,
    bottleneck: 'gpu',
    causes: [],
    networkSeverity: 'ok',
    programs: [],
    passport: EMPTY_PASSPORT,
    scene: { kind: 'replay', replayFile: 'test.dem', startTick: 1000, note: null },
  }));
}

describe('compareRepeatedSessions', () => {
  it('показывает повторившееся улучшение и диапазон между прогонами', () => {
    const result = compareRepeatedSessions(group('до', [30, 32, 31]), group('после', [20, 22, 21]));
    expect(result.status).toBe('better');
    expect(result.metrics.find((m) => m.id === 'frameTimeP99')).toMatchObject({
      before: { min: 30, median: 31, max: 32 },
      after: { min: 20, median: 21, max: 22 },
      direction: 'better',
    });
    expect(result.caveats.join(' ')).toContain('не доверительные интервалы');
  });

  it('показывает повторившееся ухудшение', () => {
    expect(
      compareRepeatedSessions(group('до', [20, 21, 22]), group('после', [30, 31, 32])).status,
    ).toBe('worse');
  });

  it('не объявляет эффект устойчивым, когда диапазоны пересекаются', () => {
    expect(
      compareRepeatedSessions(group('до', [20, 30, 40]), group('после', [18, 28, 38])).status,
    ).toBe('inconclusive');
  });

  it('не скрывает противоположный результат одного прогона за медианой', () => {
    expect(
      compareRepeatedSessions(group('до', [30, 30, 30]), group('после', [20, 20, 40])).status,
    ).toBe('mixed');
  });

  it('сохраняет отсутствие заметных изменений', () => {
    expect(
      compareRepeatedSessions(group('до', [30, 30, 30]), group('после', [30, 30, 30])).status,
    ).toBe('inconclusive');
  });

  it.each(['scene', 'application', 'duration', 'unknown-tick'] as const)(
    'отказывает при несовместимых условиях: %s',
    (kind) => {
      const after = group('после', [20, 20, 20]);
      after[1] = {
        ...after[1]!,
        ...(kind === 'scene'
          ? { scene: { ...after[1]!.scene, replayFile: 'other.dem' } }
          : kind === 'application'
            ? { application: 'other.exe' }
            : kind === 'duration'
              ? { durationSeconds: 90 }
              : { scene: { ...after[1]!.scene, startTick: null } }),
      };
      expect(compareRepeatedSessions(group('до', [30, 30, 30]), after).status).toBe(
        'not-comparable',
      );
    },
  );

  it('отвергает повторное использование записи и неполную серию', () => {
    const before = group('до', [30, 30, 30]);
    expect(() => compareRepeatedSessions(before, before)).toThrow('один раз');
    expect(() => compareRepeatedSessions(before.slice(0, 2), group('после', [20, 20]))).toThrow(
      'от 3 до 5',
    );
  });

  it('не называет появление статтеров улучшением при снизившемся p99', () => {
    const before = group('до', [30, 31, 32]).map((s) => ({
      ...s,
      stutterCount: 0,
      stuttersPerMinute: 0,
    }));
    expect(compareRepeatedSessions(before, group('после', [20, 21, 22])).status).toBe('mixed');
  });

  it('отказывает, если настройки менялись внутри группы', () => {
    const before = group('до', [30, 31, 32]);
    before[1] = {
      ...before[1]!,
      passport: { settings: [{ key: 'cvar.fps_max', label: 'fps_max', value: '60' }] },
    };
    const result = compareRepeatedSessions(before, group('после', [20, 21, 22]));
    expect(result.status).toBe('not-comparable');
    expect(result.caveats.join(' ')).toContain('Внутри группы');
  });

  it('показывает ограничение при смене фоновых программ', () => {
    const after = group('после', [20, 21, 22]).map((s) => ({
      ...s,
      programs: [{ name: 'discord.exe', usualPercent: 2 }],
    }));
    expect(compareRepeatedSessions(group('до', [30, 31, 32]), after).caveats.join(' ')).toContain(
      'Набор фоновых программ менялся',
    );
  });
});
