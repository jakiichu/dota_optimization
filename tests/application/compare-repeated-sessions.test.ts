import { describe, expect, it, vi } from 'vitest';
import type { SessionRecord, SessionStore } from '../../src/application/ports/session-store.port.ts';
import { CompareSessions } from '../../src/application/use-cases/compare-sessions.ts';
import { createSessionCompareRoute } from '../../src/main/session-routes.ts';
import { EMPTY_PASSPORT } from '../../src/domain/snapshot/machine-passport.ts';
import type { RepeatedComparison } from '../../src/domain/telemetry/repeated-comparison.ts';
import { frameTrace } from '../support/frame-builder.ts';

function makeStore(): SessionStore {
  return {
    save: vi.fn(), list: vi.fn(),
    load: vi.fn(async (id: string): Promise<SessionRecord> => {
      const ms = id.startsWith('before') ? 30 : 20;
      return {
        id, label: id, capturedAt: '2026-09-11T10:00:00Z', metricsVersion: 0,
        capture: { applicationName: 'dota2.exe', processId: 1,
          availableColumns: ['FrameTime'], frames: frameTrace(Array<number>(60000 / ms).fill(ms)) },
        sensors: [], passport: EMPTY_PASSPORT,
        scene: { kind: 'replay', replayFile: 'test.dem', startTick: 1000, note: null },
      };
    }),
  };
}

describe('повторное сравнение сохранённых записей', () => {
  it('принимает группы через маршрут и пересчитывает сырые кадры', async () => {
    const store = makeStore();
    const query = new URLSearchParams({ mode: 'repeated' });
    for (let i = 0; i < 3; i++) { query.append('before', `before-${i}`); query.append('after', `after-${i}`); }
    const result = await createSessionCompareRoute(store).handle(query, '') as RepeatedComparison;
    expect(store.list).not.toHaveBeenCalled();
    expect(store.load).toHaveBeenCalledTimes(6);
    expect(result.status).toBe('better');
    expect(result.pairs.map((pair) => pair.before.id)).toEqual(['before-0', 'before-1', 'before-2']);
    expect(result.metrics.find((m) => m.id === 'frameTimeP99')?.after.median).toBe(20);
  });

  it('отвергает повторяющиеся записи до чтения больших файлов', async () => {
    const store = makeStore();
    await expect(new CompareSessions(store).executeRepeated(['a', 'b', 'c'], ['a', 'd', 'e'])).rejects.toThrow('один раз');
    expect(store.load).not.toHaveBeenCalled();
  });
});
