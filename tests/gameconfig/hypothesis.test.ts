import { describe, expect, it } from 'vitest';
import { checkHypothesis, type Prediction } from '../../src/domain/gameconfig/hypothesis.ts';
import {
  compareSessions,
  type SessionSummary,
} from '../../src/domain/telemetry/session-comparison.ts';
import type { CaptureScene } from '../../src/domain/telemetry/capture-scene.ts';

const REPLAY: CaptureScene = {
  kind: 'replay',
  replayFile: '8865634649.dem',
  startTick: 42000,
  note: null,
};

const OTHER_SCENE: CaptureScene = {
  kind: 'match',
  replayFile: null,
  startTick: null,
  note: null,
};

interface Numbers {
  readonly averageFps?: number;
  readonly p99?: number;
  readonly pacing?: number;
  readonly stutters?: number;
  readonly scene?: CaptureScene;
}

function session(id: string, numbers: Numbers = {}): SessionSummary {
  const p99 = numbers.p99 ?? 20;
  return {
    id,
    label: id,
    application: 'dota2.exe',
    capturedAt: '2026-09-10T10:00:00Z',
    durationSeconds: 60,
    frameCount: 3600,
    averageFps: numbers.averageFps ?? 60,
    frameTime: { p50: 16.6, p95: 18, p99, p999: p99 + 5 },
    inputLatency: null,
    stutterCount: 10,
    stuttersPerMinute: numbers.stutters ?? 10,
    pacingTimeShare: numbers.pacing ?? 0.2,
    bottleneck: 'cpu',
    scene: numbers.scene ?? REPLAY,
  };
}

const PACING_DOWN: Prediction = { metric: 'pacing', direction: 'down', cost: 'fps' };

function check(before: SessionSummary, after: SessionSummary, prediction = PACING_DOWN) {
  return checkHypothesis(prediction, compareSessions(before, after));
}

describe('checkHypothesis', () => {
  it('подтверждает предсказание, когда метрика поехала куда обещали', () => {
    const found = check(
      session('до', { pacing: 0.205, averageFps: 118 }),
      session('после', { pacing: 0.111, averageFps: 59 }),
    );

    expect(found.outcome).toBe('confirmed');
    expect(found.summary).toContain('Подтвердилась');
  });

  it('называет цену, о которой предупреждали', () => {
    const found = check(
      session('до', { pacing: 0.205, averageFps: 118 }),
      session('после', { pacing: 0.111, averageFps: 59 }),
    );

    expect(found.paid?.id).toBe('fps');
    expect(found.summary).toContain('Цена');
  });

  it('говорит «не подтвердилась», когда ничего не изменилось', () => {
    // Это не то же самое, что «стало хуже»: правка просто не сделала того,
    // ради чего её предлагали, и действия по такому итогу другие.
    const found = check(
      session('до', { pacing: 0.2 }),
      session('после', { pacing: 0.199 }),
    );

    expect(found.outcome).toBe('no-change');
    expect(found.summary).toContain('разброс');
  });

  it('опровергает предсказание и велит вернуть настройку', () => {
    const found = check(
      session('до', { pacing: 0.1 }),
      session('после', { pacing: 0.3 }),
    );

    expect(found.outcome).toBe('refuted');
    expect(found.summary).toContain('Верните настройку');
  });

  it('отказывается судить по записям из разных сцен', () => {
    // Инструмент, который сравнил бы их молча, выдал бы разницу сцен за
    // результат правки — ровно та ошибка, ради которой всё и делалось.
    const found = check(
      session('до', { pacing: 0.4 }),
      session('после', { pacing: 0.1, scene: OTHER_SCENE }),
    );

    expect(found.outcome).toBe('not-comparable');
  });

  it('предупреждает, когда предсказание сбылось, а в целом стало хуже', () => {
    // Ритм выровнялся, но самые долгие кадры выросли вдвое. Зелёная галочка
    // без оговорки была бы одобрением вредной правки.
    const found = check(
      session('до', { pacing: 0.3, p99: 20, stutters: 10 }),
      session('после', { pacing: 0.1, p99: 40, stutters: 25 }),
    );

    expect(found.outcome).toBe('confirmed');
    expect(found.betterOnPaper).toBe(true);
    expect(found.summary).toContain('в целом стало хуже');
  });

  it('молчит про метрику, которой нет в записях', () => {
    const found = check(session('до'), session('после'), {
      metric: 'inputLatency',
      direction: 'down',
      cost: null,
    });

    expect(found.outcome).toBe('not-measured');
  });

  it('не выдумывает цену там, где её не объявляли', () => {
    const found = check(session('до', { p99: 30 }), session('после', { p99: 20 }), {
      metric: 'frameTimeP99',
      direction: 'down',
      cost: null,
    });

    expect(found.outcome).toBe('confirmed');
    expect(found.paid).toBeNull();
    expect(found.summary).not.toContain('Цена');
  });
});
