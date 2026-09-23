import { describe, expect, it } from 'vitest';
import { sessionRecap } from '../../web/src/domain/session-recap.ts';
import { reportCapture } from '../support/report-builder.ts';
describe('краткий итог записи', () => {
  it('отличает отсутствие рывков от гарантии плавности', () => {
    const recap = sessionRecap({ ...reportCapture(), stutterCount: 0 });
    expect(recap.observation).toContain('не исключает');
  });
  it('не выдаёт фоновую нагрузку за доказанную причину', () => {
    const base = reportCapture();
    const recap = sessionRecap({
      ...base,
      stutterCount: 4,
      correlation: {
        ...base.correlation,
        tally: [{ kind: 'background-process', label: 'фон', count: 3 }],
      },
    });
    expect(recap.observation).toContain('3 из 4');
    expect(recap.observation).toContain('не доказывает');
    expect(recap.next).toContain('одну ненужную');
  });
  it('показывает ограничения при отсутствии датчиков и коротком замере', () => {
    const recap = sessionRecap({ ...reportCapture(), sensorSampleCount: 0, durationSeconds: 5 });
    expect(recap.limitations.join(' ')).toContain('датчиков отсутствуют');
    expect(recap.limitations.join(' ')).toContain('Короткая запись');
  });
  it('не рекомендует изменение настроек для пустой записи', () => {
    const recap = sessionRecap({ ...reportCapture(), frameCount: 0 });
    expect(recap.observation).toContain('Недостаточно');
    expect(recap.expectation).toBeNull();
  });
});
