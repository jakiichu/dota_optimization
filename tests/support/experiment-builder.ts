import type { Hypothesis, SessionSummary } from '../../web/src/domain/models.ts';

export function experimentSession(
  id = 'before',
  capturedAt = '2026-09-11T10:00:00Z',
): SessionSummary {
  return {
    id,
    label: `Тестовый прогон ${id}`,
    application: 'dota2.exe',
    capturedAt,
    durationSeconds: 60,
    frameCount: 3600,
    averageFps: 60,
    frameTime: { p50: 16, p95: 20, p99: 30, p999: 40 },
    inputLatency: null,
    stutterCount: 5,
    stuttersPerMinute: 5,
    pacingTimeShare: 0.1,
    bottleneck: 'gpu',
    scene: { kind: 'replay', replayFile: 'test.dem', startTick: 1000, note: null },
  };
}

export function experimentHypothesis(): Hypothesis {
  return {
    id: 'test-hypothesis',
    createdAt: '2026-09-11T11:00:00Z',
    recommendation: {
      kind: 'frame-cap',
      title: 'Проверить ограничение кадров',
      evidence: 'Тестовые данные для проверки интерфейса',
      expect: 'Проверить ровность ритма',
      changes: [{ cvar: 'fps_max', value: '60', why: 'Тестовая настройка' }],
      risk: '',
      confidence: 'likely',
      prediction: { metric: 'pacing', direction: 'down', cost: 'fps' },
    },
    before: experimentSession(),
    after: null,
    comparison: null,
    check: null,
    unexpected: [],
    candidates: [],
  };
}
