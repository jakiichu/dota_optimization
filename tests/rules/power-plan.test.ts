import { describe, expect, it } from 'vitest';
import { coreParkingRule } from '../../src/domain/rules/power-plan.rule.ts';
import { snapshotWith } from '../support/snapshot-builder.ts';

function withMinCores(percent: number | null) {
  return snapshotWith({
    power: {
      activeSchemeGuid: '381b4222-f694-41f0-9685-ff5bb260df2e',
      activeSchemeName: 'Сбалансированная',
      minProcessorCoresPercentAc: percent,
      isLaptop: false,
      onBattery: null,
    },
  });
}

describe('coreParkingRule', () => {
  it('предупреждает, когда часть ядер может парковаться', () => {
    const finding = coreParkingRule.evaluate(withMinCores(50));

    expect(finding?.severity).toBe('warning');
    expect(finding?.summary).toContain('50%');
  });

  it('считает 100% нормой', () => {
    expect(coreParkingRule.evaluate(withMinCores(100))?.severity).toBe('ok');
  });

  it('отличает «не прочитали» от «выключено»', () => {
    const finding = coreParkingRule.evaluate(withMinCores(null));

    expect(finding?.severity).toBe('unknown');
  });
});
