import { describe, expect, it } from 'vitest';
import { memoryUsageRule, diskSpaceRule, backgroundUsageRule } from '../../src/domain/rules/resource-usage.rule.ts';
import { memoryIntegrityRule } from '../../src/domain/rules/memory-integrity.rule.ts';
import { toSystemSnapshot } from '../../src/infrastructure/windows/snapshot.mapper.ts';
import { snapshotWith } from '../support/snapshot-builder.ts';
import type { ResourceUsage } from '../../src/domain/snapshot/system-snapshot.ts';
const GB = 1024 ** 3;
const resources: ResourceUsage = { memory: { totalBytes: 16 * GB, availableBytes: 8 * GB }, disks: null, processes: null, sampleSeconds: 15 };
const snapshot = (patch: Partial<ResourceUsage>) => snapshotWith({ resources: { ...resources, ...patch } });

describe('проверка ресурсов', () => {
  it('старые снимки остаются читаемыми, отсутствующие данные не становятся нормой', () => {
    const old = toSystemSnapshot({});
    for (const rule of [memoryUsageRule, diskSpaceRule, backgroundUsageRule, memoryIntegrityRule]) expect(rule.evaluate(old)?.severity).toBe('unknown');
  });
  it('предупреждает о малом абсолютном и относительном запасе памяти', () => {
    expect(memoryUsageRule.evaluate(snapshot({ memory: { totalBytes: 16 * GB, availableBytes: GB } }))?.severity).toBe('warning');
    expect(memoryUsageRule.evaluate(snapshot({ memory: { totalBytes: 64 * GB, availableBytes: 8 * GB } }))?.severity).toBe('ok');
    expect(memoryUsageRule.evaluate(snapshot({ memory: { totalBytes: GB, availableBytes: 2 * GB } }))?.severity).toBe('unknown');
  });
  it('объединяет процессы браузера, исключает Dota и считает среднюю долю CPU', () => {
    const result = backgroundUsageRule.evaluate(snapshot({ processes: [
      { name: 'chrome', cpuPercent: 8, memoryBytes: GB },
      { name: 'Chrome', cpuPercent: 9, memoryBytes: GB },
      { name: 'dota2.exe', cpuPercent: 50, memoryBytes: GB },
    ] }));
    expect(result?.severity).toBe('warning'); expect(result?.summary).toContain('17.0%'); expect(result?.observed).toContain('2.0 ГБ');
    expect(result?.observed).not.toContain('dota2');
  });
  it('не выдаёт пустой или неудачный замер за отсутствие нагрузки', () => {
    expect(backgroundUsageRule.evaluate(snapshot({ processes: [] }))?.severity).toBe('unknown');
    expect(backgroundUsageRule.evaluate(snapshot({ processes: [{ name: 'a', cpuPercent: 1, memoryBytes: 1 }], sampleSeconds: 0 }))?.severity).toBe('unknown');
  });
  it('не предупреждает о постороннем диске, но отмечает неизвестный игровой диск', () => {
    const result = diskSpaceRule.evaluate(snapshot({ disks: [
      { name: 'C:', system: true, totalBytes: 100 * GB, freeBytes: 50 * GB },
      { name: 'D:', system: false, totalBytes: 100 * GB, freeBytes: GB },
    ] }));
    expect(result?.severity).toBe('unknown'); expect(result?.observed).not.toContain('D:');
  });
  it('сохраняет предупреждение о системном диске даже без данных об игре', () => {
    expect(diskSpaceRule.evaluate(snapshot({ disks: [{ name: 'C:', system: true, totalBytes: 100 * GB, freeBytes: GB }] }))?.severity).toBe('warning');
  });
  it('сопоставляет игровой диск без учёта регистра', () => {
    const base = snapshot({ disks: [{ name: 'C:', system: true, totalBytes: 100 * GB, freeBytes: 50 * GB }] });
    const games = toSystemSnapshot({ games: { appId: '570', installDir: 'c:/Steam/dota' } }).games;
    expect(diskSpaceRule.evaluate({ ...base, games })?.severity).toBe('ok');
  });
  it('отбрасывает неверные числа и разбирает одиночный объект PowerShell', () => {
    const parsed = toSystemSnapshot({ resources: { memory: { totalBytes: -1 }, disks: { name: 'C:', freeBytes: -1 }, processes: [{ name: 'bad', cpuPercent: 101, memoryBytes: 1 }] } });
    expect(parsed.resources?.memory.totalBytes).toBeNull(); expect(parsed.resources?.disks?.[0]?.freeBytes).toBeNull(); expect(parsed.resources?.processes).toEqual([]);
  });
});
