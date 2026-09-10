import { describe, expect, it } from 'vitest';
import { corroborate } from '../../src/domain/diagnostics/corroboration.ts';
import type { Finding } from '../../src/domain/diagnostics/finding.ts';
import { EMPTY_PASSPORT } from '../../src/domain/snapshot/machine-passport.ts';
import { UNKNOWN_SCENE } from '../../src/domain/telemetry/capture-scene.ts';
import type { SessionSummary } from '../../src/domain/telemetry/session-comparison.ts';
import type { CauseTally } from '../../src/domain/telemetry/stutter-correlation.ts';

interface Measured {
  readonly causes?: readonly CauseTally[];
  readonly stutterCount?: number;
  readonly pacing?: number;
  readonly network?: SessionSummary['networkSeverity'];
}

function session(measured: Measured = {}): SessionSummary {
  return {
    id: 'запись',
    label: 'бой',
    application: 'dota2.exe',
    capturedAt: '2026-09-10T10:00:00Z',
    durationSeconds: 60,
    frameCount: 3600,
    averageFps: 60,
    frameTime: { p50: 16.6, p95: 18, p99: 20, p999: 25 },
    inputLatency: null,
    stutterCount: measured.stutterCount ?? 11,
    stuttersPerMinute: 11,
    pacingTimeShare: measured.pacing ?? 0,
    bottleneck: 'cpu',
    causes: measured.causes ?? [],
    networkSeverity: measured.network ?? 'ok',
    scene: UNKNOWN_SCENE,
    passport: EMPTY_PASSPORT,
  };
}

function finding(ruleId: string, severity: Finding['severity'] = 'warning'): Finding {
  return {
    ruleId,
    title: ruleId,
    severity,
    summary: '',
    observed: '',
    expected: '',
    impact: '',
    remediation: [],
  };
}

const PRESENT_MODE: CauseTally = {
  kind: 'present-mode',
  label: 'Сменился режим вывода',
  count: 4,
};

describe('corroborate', () => {
  it('подтверждает предупреждение числами из записи', () => {
    // Ровно то, ради чего инструмент затевался: не «так бывает плохо», а
    // «у вас это происходит, вот сколько раз».
    const found = corroborate(
      [finding('graphics.mpo')],
      session({ causes: [PRESENT_MODE], stutterCount: 11 }),
    );

    expect(found[0]?.confirmed).toBe(true);
    expect(found[0]?.detail).toContain('4 из 11');
  });

  it('приглушает предупреждение, когда следов в записи нет', () => {
    // Вторая половина важнее первой: сейчас аудит пугает всех одинаково, хотя
    // у половины людей эта настройка ничего не стоит.
    const found = corroborate([finding('graphics.mpo')], session({ stutterCount: 11 }));

    expect(found[0]?.confirmed).toBe(false);
    expect(found[0]?.detail).toContain('ни один');
  });

  it('молчит, когда записей нет вовсе', () => {
    // «Не проявилось» и «не мерили» — разные вещи, и вторая не должна выглядеть
    // как первая.
    expect(corroborate([finding('graphics.mpo')], null)).toEqual([]);
  });

  it('молчит, когда статтеров не было: сверять не с чем', () => {
    const found = corroborate([finding('graphics.mpo')], session({ stutterCount: 0 }));

    expect(found).toEqual([]);
  });

  it('не сверяет то, что и так в порядке', () => {
    const found = corroborate(
      [finding('graphics.mpo', 'ok')],
      session({ causes: [PRESENT_MODE] }),
    );

    expect(found).toEqual([]);
  });

  it('связывает частоту экрана с рваным ритмом', () => {
    const found = corroborate([finding('display.refresh-rate')], session({ pacing: 0.2 }));

    expect(found[0]?.confirmed).toBe(true);
    expect(found[0]?.detail).toContain('20%');
  });

  it('связывает беспроводной канал с измеренной сетью', () => {
    const dodgy = corroborate([finding('network.active-link')], session({ network: 'bad' }));
    const clean = corroborate([finding('network.active-link')], session({ network: 'ok' }));

    expect(dodgy[0]?.confirmed).toBe(true);
    expect(clean[0]?.confirmed).toBe(false);
    expect(clean[0]?.detail).toContain('ровно');
  });

  it('не выдумывает связей там, где механизм не прямой', () => {
    // Притянуть за уши можно почти любую пару, но тогда «подтверждено записью»
    // перестанет что-либо значить.
    const found = corroborate(
      [finding('driver.freshness'), finding('security.hvci')],
      session({ causes: [PRESENT_MODE] }),
    );

    expect(found).toEqual([]);
  });
});
