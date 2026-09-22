import { useState } from 'react';
import { useRepeatedComparison } from '../../application/queries.ts';
import type { SessionSummary } from '../../domain/models.ts';
import { dateTime, withUnit } from '../../domain/formatting.ts';
import { VERDICT_COLOR } from '../../domain/presentation.ts';
import { ErrorState } from './States.tsx';

export function RepeatedComparisonPanel({ sessions }: { sessions: readonly SessionSummary[] }): React.JSX.Element {
  const [before, setBefore] = useState(['', '', '']);
  const [after, setAfter] = useState(['', '', '']);
  const result = useRepeatedComparison(before, after);
  const selected = [...before, ...after].filter(Boolean);
  const duplicate = new Set(selected).size !== selected.length;
  const update = (side: 'before' | 'after', index: number, id: string): void => {
    (side === 'before' ? setBefore : setAfter)((ids) => ids.map((old, i) => i === index ? id : old));
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Повторные замеры</span>
        <span className="card-note">3 записи до и 3 после</span>
      </div>
      <p className="muted">Запишите один участок повтора трижды с исходной настройкой.
        Измените одну настройку, примените её в игре и запишите тот же участок ещё трижды.
        Сохраняйте длительность, камеру и фоновые программы. Выберите записи в порядке прогонов.</p>
      {sessions.length < 6 && <p className="muted">Для проверки нужны шесть разных записей. Сейчас доступно: {sessions.length}.</p>}
      {before.map((_, index) => (
        <div className="capture-form" key={index}>
          {(['before', 'after'] as const).map((side) => (
            <label key={side}>
              <span className="metric-label">{side === 'before' ? 'до' : 'после'} · прогон {index + 1}</span>
              <select className="input" value={(side === 'before' ? before : after)[index]}
                onChange={(event) => update(side, index, event.target.value)}>
                <option value="">Выберите запись</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}
                    disabled={selected.includes(session.id) && (side === 'before' ? before : after)[index] !== session.id}>
                    {session.label} · {dateTime(session.capturedAt)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
      {duplicate && <p className="notice error">Каждая запись должна использоваться только один раз.</p>}
      {result.isFetching && <p className="muted">Пересчитываю записи и проверяю повторяемость…</p>}
      {result.isError && <ErrorState message={result.error.message} onRetry={() => void result.refetch()} />}
      {result.data !== undefined && (
        <>
          <p className="verdict" style={{ color: result.data.status === 'inconclusive' || result.data.status === 'not-comparable'
            ? 'var(--muted)' : VERDICT_COLOR[result.data.status] }}>{result.data.summary}</p>
          <table className="table">
            <thead><tr><th>метрика</th><th>до · медиана [мин–макс]</th><th>после · медиана [мин–макс]</th></tr></thead>
            <tbody>{result.data.metrics.map((metric) => (
              <tr key={metric.id}>
                <td>{metric.label}</td>
                {[metric.before, metric.after].map((values, i) => (
                  <td key={i}>{withUnit(values.median, metric.unit)} [{values.min.toFixed(1)}–{values.max.toFixed(1)}]</td>
                ))}
              </tr>
            ))}</tbody>
          </table>
          <details><summary>Результаты каждой пары</summary>
            <ol>{result.data.pairs.map((pair) => <li key={pair.before.id}>{pair.before.label} → {pair.after.label}: {pair.summary}</li>)}</ol>
          </details>
          <div className="errors">Ограничения вывода:
            <ul>{result.data.caveats.map((text) => <li key={text}>{text}</li>)}</ul>
          </div>
        </>
      )}
    </div>
  );
}
