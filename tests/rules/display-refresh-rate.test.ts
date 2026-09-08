import { describe, expect, it } from 'vitest';
import { displayRefreshRateRule } from '../../src/domain/rules/display-refresh-rate.rule.ts';
import { snapshotWith } from '../support/snapshot-builder.ts';

function display(current: number | null, max: number | null) {
  return {
    adapterName: 'Test GPU',
    horizontalResolution: 2560,
    verticalResolution: 1440,
    currentRefreshHz: current,
    maxRefreshHz: max,
  };
}

describe('displayRefreshRateRule', () => {
  it('помечает как критичное, если монитор работает ниже своего максимума', () => {
    const finding = displayRefreshRateRule.evaluate(
      snapshotWith({ displays: [display(60, 144)] }),
    );

    expect(finding?.severity).toBe('critical');
    expect(finding?.observed).toContain('60 Гц из 144 Гц');
  });

  it('не жалуется, когда частота уже максимальная', () => {
    const finding = displayRefreshRateRule.evaluate(
      snapshotWith({ displays: [display(144, 144)] }),
    );

    expect(finding?.severity).toBe('ok');
  });

  it('не считает проблемой выход, для которого частоты неизвестны', () => {
    const finding = displayRefreshRateRule.evaluate(
      snapshotWith({ displays: [display(null, null)] }),
    );

    expect(finding?.severity).toBe('unknown');
  });

  it('находит проблемный выход среди исправных', () => {
    const finding = displayRefreshRateRule.evaluate(
      snapshotWith({ displays: [display(240, 240), display(60, 165)] }),
    );

    expect(finding?.severity).toBe('critical');
    expect(finding?.observed).toContain('60 Гц из 165 Гц');
    expect(finding?.observed).not.toContain('240');
  });
});
