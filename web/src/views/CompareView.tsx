import { useEffect, useState } from 'react';
import {
  fetchComparison,
  fetchSessions,
  type SessionComparison,
  type SessionSummary,
  type SessionVerdict,
} from '../api.ts';

const VERDICT_COLOR: Record<SessionVerdict, string> = {
  better: 'var(--ok)',
  worse: 'var(--critical)',
  same: 'var(--muted)',
};

const VERDICT_LABEL: Record<SessionVerdict, string> = {
  better: 'лучше',
  worse: 'хуже',
  same: 'без изменений',
};

/**
 * Сравнение двух записей.
 *
 * Половина советов из аудита звучит как «померь до и после» — этот экран
 * единственное место, где такой совет можно выполнить честно.
 */
export function CompareView(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [beforeId, setBeforeId] = useState<string>('');
  const [afterId, setAfterId] = useState<string>('');
  const [comparison, setComparison] = useState<SessionComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSessions(controller.signal)
      .then((list) => {
        setSessions(list);
        // По умолчанию сравниваем две последние: обычно именно их и делают
        // до и после правки настройки.
        setAfterId(list[0]?.id ?? '');
        setBeforeId(list[1]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, []);

  const compare = (): void => {
    const controller = new AbortController();
    setError(null);
    fetchComparison(beforeId, afterId, controller.signal)
      .then(setComparison)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  };

  if (error !== null && sessions === null) {
    return <div className="notice error">{error}</div>;
  }

  if (sessions === null) {
    return <div className="notice">Читаю список записей…</div>;
  }

  if (sessions.length < 2) {
    return (
      <div className="notice">
        Для сравнения нужны минимум две записи, сейчас {sessions.length}. Сделайте вторую
        на вкладке «Запись кадров» — до и после изменения настройки.
      </div>
    );
  }

  return (
    <>
      <div className="capture-form">
        <label>
          <span className="metric-label">до</span>
          <SessionPicker sessions={sessions} value={beforeId} onChange={setBeforeId} />
        </label>
        <label>
          <span className="metric-label">после</span>
          <SessionPicker sessions={sessions} value={afterId} onChange={setAfterId} />
        </label>
        <button
          type="button"
          className="button"
          onClick={compare}
          disabled={beforeId === '' || afterId === '' || beforeId === afterId}
        >
          Сравнить
        </button>
      </div>

      {error !== null && <div className="notice error">{error}</div>}
      {comparison !== null && <ComparisonReport comparison={comparison} />}
    </>
  );
}

function SessionPicker({
  sessions,
  value,
  onChange,
}: {
  sessions: SessionSummary[];
  value: string;
  onChange: (id: string) => void;
}): React.JSX.Element {
  return (
    <select
      className="input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{ minWidth: 260 }}
    >
      {sessions.map((session) => (
        <option key={session.id} value={session.id}>
          {session.label} · {session.durationSeconds.toFixed(0)} с ·{' '}
          {new Date(session.capturedAt).toLocaleString('ru')}
        </option>
      ))}
    </select>
  );
}

function ComparisonReport({
  comparison,
}: {
  comparison: SessionComparison;
}): React.JSX.Element {
  return (
    <>
      <div className="gpu-card" style={{ marginBottom: 12 }}>
        <div className="bottleneck" style={{ color: VERDICT_COLOR[comparison.verdict] }}>
          {comparison.summary}
        </div>
        {comparison.bottleneckChanged && (
          <div className="finding-summary">
            Узкое место сменилось: {comparison.before.bottleneck} →{' '}
            {comparison.after.bottleneck}
          </div>
        )}
      </div>

      <div className="gpu-card" style={{ marginBottom: 12 }}>
        <table className="stutters">
          <thead>
            <tr>
              <th>метрика</th>
              <th>до</th>
              <th>после</th>
              <th>изменение</th>
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map((metric) => (
              <tr key={metric.label}>
                <td>{metric.label}</td>
                <td>
                  {metric.before.toFixed(1)} {metric.unit}
                </td>
                <td>
                  {metric.after.toFixed(1)} {metric.unit}
                </td>
                <td style={{ color: VERDICT_COLOR[metric.verdict] }}>
                  {formatDelta(metric.delta, metric.unit)} · {VERDICT_LABEL[metric.verdict]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Оговорки обязательны: молчаливое сравнение несопоставимых записей
          выглядит убедительнее, чем оно есть. */}
      {comparison.caveats.length > 0 && (
        <div className="errors">
          Насколько этому можно верить:
          <ul>
            {comparison.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function formatDelta(delta: number, unit: string): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)} ${unit}`.trim();
}
