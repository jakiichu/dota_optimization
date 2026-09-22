import { describe, expect, it } from 'vitest';
import { experimentProgress } from '../../web/src/domain/experiment-progress.ts';
import { experimentHypothesis, experimentSession } from '../support/experiment-builder.ts';

describe('шаги проверки настройки', () => {
  it('предлагает сохранить отсутствующую настройку', () => {
    expect(experimentProgress(experimentHypothesis(), [], []).step).toBe('config');
  });

  it('после сохранения предлагает повторную запись, не подтверждая применение в игре', () => {
    expect(experimentProgress(experimentHypothesis(), [{ name: 'FPS_MAX', value: '60' }], [])).toMatchObject({ step: 'capture', saved: true });
  });

  it('учитывает последнее значение повторяющейся переменной', () => {
    expect(experimentProgress(experimentHypothesis(), [{ name: 'fps_max', value: '60' }, { name: 'fps_max', value: '120' }], []).saved).toBe(false);
  });

  it('не принимает отсутствие данных о конфиге за сохранение', () => {
    expect(experimentProgress(experimentHypothesis(), undefined, []).saved).toBe(false);
  });

  it('предлагает только совместимые записи после начала проверки', () => {
    const hypothesis = { ...experimentHypothesis(), candidates: [
      { id: 'old', comparable: true }, { id: 'new', comparable: true },
      { id: 'different', comparable: false }, { id: 'missing', comparable: true },
    ] };
    const sessions = [experimentSession('old', '2026-09-11T10:30:00Z'),
      experimentSession('new', '2026-09-11T12:00:00Z'), experimentSession('different', '2026-09-11T12:30:00Z')];
    expect(experimentProgress(hypothesis, [], sessions)).toMatchObject({ step: 'compare', candidates: ['new'] });
  });

  it('показывает итог завершённой проверки даже после возврата настройки', () => {
    const hypothesis = { ...experimentHypothesis(), check: {
      outcome: 'no-change' as const, summary: 'Эффект не обнаружен', predicted: null,
      paid: null, betterOnPaper: false, regressed: [],
    } };
    expect(experimentProgress(hypothesis, [], []).step).toBe('done');
  });

  it('не продолжает проверку без исходной записи', () => {
    expect(experimentProgress({ ...experimentHypothesis(), before: null }, [], []).step).toBe('missing-baseline');
  });
});
