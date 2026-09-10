import { useEffect, useState } from 'react';
import { useComparison, useSessions } from '../../application/queries.ts';
import type { Comparison, PassportChange, SessionSummary } from '../../domain/models.ts';
import { VERDICT_COLOR, VERDICT_LABEL } from '../../domain/presentation.ts';
import { dateTime, seconds, signed, withUnit } from '../../domain/formatting.ts';
import { HypothesisPanel } from '../components/HypothesisPanel.tsx';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from '../components/States.tsx';

export function CompareSection(): React.JSX.Element {
  const sessions = useSessions();
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');

  // По умолчанию сравниваем две последние: обычно именно их и делают до и после
  // правки настройки.
  useEffect(() => {
    const list = sessions.data;
    if (list === undefined || list.length < 2) return;
    setAfterId((current) => (current === '' ? (list[0]?.id ?? '') : current));
    setBeforeId((current) => (current === '' ? (list[1]?.id ?? '') : current));
  }, [sessions.data]);

  const comparison = useComparison(beforeId, afterId);

  if (sessions.isPending) {
    return <LoadingState what="Читаю список записей…" />;
  }
  if (sessions.isError) {
    return (
      <ErrorState message={sessions.error.message} onRetry={() => void sessions.refetch()} />
    );
  }

  if (sessions.data.length < 2) {
    return (
      <>
        <SectionHeader title="Сравнение" subtitle="до и после правки" />
        <HypothesisPanel />
        <EmptyState>
          Нужны минимум две записи, сейчас {sessions.data.length}. Сделайте вторую в
          разделе «Запись кадров» — до и после изменения настройки.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <SectionHeader
        title="Сравнение"
        subtitle="до и после правки"
        stale={comparison.isFetching}
      />

      {/* Гипотезы первыми: это ответ на вопрос, который человек задал сам,
          а всё, что ниже, — сравнение двух записей вообще. */}
      <HypothesisPanel />

      <div className="capture-form">
        <label>
          <span className="metric-label">до</span>
          <SessionPicker sessions={sessions.data} value={beforeId} onChange={setBeforeId} />
        </label>
        <label>
          <span className="metric-label">после</span>
          <SessionPicker sessions={sessions.data} value={afterId} onChange={setAfterId} />
        </label>
      </div>

      {beforeId === afterId && (
        <EmptyState>Выберите две разные записи.</EmptyState>
      )}
      {comparison.isPending && beforeId !== afterId && (
        <LoadingState what="Считаю разницу…" />
      )}
      {comparison.isError && <ErrorState message={comparison.error.message} />}
      {comparison.data !== undefined && <ComparisonReport comparison={comparison.data} />}
    </>
  );
}

function SessionPicker({
  sessions,
  value,
  onChange,
}: {
  sessions: readonly SessionSummary[];
  value: string;
  onChange: (id: string) => void;
}): React.JSX.Element {
  return (
    <select
      className="input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{ minWidth: 280 }}
    >
      {sessions.map((session) => (
        <option key={session.id} value={session.id}>
          {session.label} · {seconds(session.durationSeconds, 0)} ·{' '}
          {dateTime(session.capturedAt)}
        </option>
      ))}
    </select>
  );
}

/**
 * Чем машина отличалась между записями.
 *
 * Раньше этого не знал никто: в записи лежали кадры и сцена, но не состояние
 * машины, и «стало лучше» приходилось соотносить с правкой по памяти.
 */
function WhatChanged({
  changes,
}: {
  changes: readonly PassportChange[];
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Что изменилось между записями</span>
        <span className="card-note">{changes.length}</span>
      </div>

      {changes.length === 0 ? (
        <div className="muted">
          Ничего не изменилось — либо настройки те же, либо записи сделаны до того,
          как приложение стало запоминать состояние машины. Во втором случае разницу
          в числах объяснить нечем.
        </div>
      ) : (
        <div className="changes">
          {changes.map((change) => (
            <div key={change.key} className="change">
              <span className="change-label">{change.label}</span>
              <code>{change.before ?? '—'}</code>
              <span className="muted">→</span>
              <code>{change.after ?? '—'}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonReport({ comparison }: { comparison: Comparison }): React.JSX.Element {
  return (
    <>
      <div className="card">
        <div className="verdict" style={{ color: VERDICT_COLOR[comparison.verdict] }}>
          {comparison.summary}
        </div>
        {comparison.bottleneckChanged && (
          <div className="muted">
            Узкое место сменилось: {comparison.before.bottleneck} →{' '}
            {comparison.after.bottleneck}
          </div>
        )}
      </div>

      {/* Что менялось — сразу за вердиктом: без этого человек видит разницу в
          числах и вспоминает по памяти, чем он её вызвал. */}
      <WhatChanged changes={comparison.changes} />

      <div className="card">
      </div>

      <div className="card">
        <table className="table">
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
                <td>{withUnit(metric.before, metric.unit)}</td>
                <td>{withUnit(metric.after, metric.unit)}</td>
                <td style={{ color: VERDICT_COLOR[metric.verdict] }}>
                  {signed(metric.delta, metric.unit)} · {VERDICT_LABEL[metric.verdict]}
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
