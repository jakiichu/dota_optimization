import type { Capture } from '../../domain/models.ts';
import { sessionRecap } from '../../domain/session-recap.ts';

export function SessionRecap({
  capture,
  onOpen,
}: {
  capture: Capture;
  onOpen?: () => void;
}): React.JSX.Element {
  const recap = sessionRecap(capture);
  return (
    <section className="card session-recap" aria-label="Краткий итог записи">
      <div className="card-head">
        <h2 className="card-title">Итог записи</h2>
        <span className="card-note">
          {capture.application} ·{' '}
          {capture.durationSeconds < 60
            ? `${Math.round(capture.durationSeconds)} с`
            : `${(capture.durationSeconds / 60).toFixed(1)} мин`}
        </span>
      </div>
      <div className="metrics">
        <div>
          <span className="metric-label">Рывков</span>
          <strong className="metric-value">{capture.stutterCount}</strong>
          <span className="metric-note">{capture.stuttersPerMinute.toFixed(1)} в минуту</span>
        </div>
        <div>
          <span className="metric-label">Средний FPS</span>
          <strong className="metric-value">{capture.averageFps.toFixed(0)}</strong>
        </div>
        <div>
          <span className="metric-label">Долгие кадры · p99</span>
          <strong className="metric-value">{capture.frameTime.p99.toFixed(1)} мс</strong>
        </div>
      </div>
      <p>{recap.observation}</p>
      <div className="notice">
        <strong>Следующий шаг</strong>
        <p>{recap.next}</p>
        {recap.expectation && (
          <p className="muted">Ожидаемый результат проверки: {recap.expectation}</p>
        )}
      </div>
      <details>
        <summary>Что учитывать</summary>
        <ul>
          {recap.limitations.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
      {onOpen && (
        <button type="button" className="button primary" onClick={onOpen}>
          Открыть подробный разбор
        </button>
      )}
    </section>
  );
}
