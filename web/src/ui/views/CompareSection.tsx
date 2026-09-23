import { useEffect, useState } from 'react';
import { useComparison, useSessions } from '../../application/queries.ts';
import type {
  Comparison,
  PassportChange,
  ProgramPresence,
  SessionSummary,
} from '../../domain/models.ts';
import { BOTTLENECK_LABEL, VERDICT_COLOR, VERDICT_LABEL } from '../../domain/presentation.ts';
import { dateTime, seconds, signed, withUnit } from '../../domain/formatting.ts';
import { HypothesisPanel } from '../components/HypothesisPanel.tsx';
import { RepeatedComparisonPanel } from '../components/RepeatedComparisonPanel.tsx';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/States.tsx';

export function CompareSection({ onCapture }: { onCapture: () => void }): React.JSX.Element {
  const sessions = useSessions();
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const [mode, setMode] = useState<'pair' | 'repeated'>('pair');

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
    return <ErrorState message={sessions.error.message} onRetry={() => void sessions.refetch()} />;
  }

  if (sessions.data.length < 2) {
    return (
      <>
        <SectionHeader
          title="Сравнение"
          subtitle="Узнайте, стала ли игра плавнее после изменения одной настройки."
        />
        <HypothesisPanel />
        <div className="card empty-guide">
          <span className="empty-guide-symbol" aria-hidden="true">
            ⇄
          </span>
          <h2>Сначала — две записи</h2>
          <p>
            Сделайте замер до изменения настройки, затем повторите ту же сцену после. Здесь появится
            сравнение плавности.
          </p>
          <span className="muted">Готово записей: {sessions.data.length} из 2 необходимых</span>
          <button className="button primary" onClick={onCapture}>
            Перейти к записи
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionHeader
        title="Сравнение"
        subtitle="Узнайте, стала ли игра плавнее после изменения одной настройки."
        stale={comparison.isFetching}
      />

      {/* Гипотезы первыми: это ответ на вопрос, который человек задал сам,
          а всё, что ниже, — сравнение двух записей вообще. */}
      <HypothesisPanel />

      <div className="capture-form">
        <button
          type="button"
          className={`button ${mode === 'pair' ? 'primary' : ''}`}
          aria-pressed={mode === 'pair'}
          onClick={() => setMode('pair')}
        >
          Две записи
        </button>
        <button
          type="button"
          className={`button ${mode === 'repeated' ? 'primary' : ''}`}
          aria-pressed={mode === 'repeated'}
          onClick={() => setMode('repeated')}
        >
          Повторные замеры
        </button>
      </div>
      <div hidden={mode !== 'repeated'}>
        <RepeatedComparisonPanel sessions={sessions.data} />
      </div>
      <div hidden={mode !== 'pair'}>
        <div className="capture-form">
          <label>
            <span className="metric-label">До изменения</span>
            <SessionPicker sessions={sessions.data} value={beforeId} onChange={setBeforeId} />
          </label>
          <label>
            <span className="metric-label">После изменения</span>
            <SessionPicker sessions={sessions.data} value={afterId} onChange={setAfterId} />
          </label>
        </div>

        {beforeId === afterId && <EmptyState>Выберите две разные записи.</EmptyState>}
        {comparison.isPending && beforeId !== afterId && <LoadingState what="Считаю разницу…" />}
        {comparison.isError && <ErrorState message={comparison.error.message} />}
        {comparison.data !== undefined && <ComparisonReport comparison={comparison.data} />}
      </div>
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
      style={{ minWidth: 0, width: '100%' }}
    >
      {sessions.map((session) => (
        <option key={session.id} value={session.id}>
          {session.label} · {seconds(session.durationSeconds, 0)} · {dateTime(session.capturedAt)}
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
  appeared,
  gone,
}: {
  changes: readonly PassportChange[];
  appeared: readonly ProgramPresence[];
  gone: readonly ProgramPresence[];
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Что изменилось между записями</span>
        <span className="card-note">{changes.length + appeared.length + gone.length}</span>
      </div>

      {/* Программы стоят рядом с настройками намеренно: настройки объясняют
          разницу ровно до тех пор, пока в фоне не появилось что-то новое. На
          живой записи Discord занимал 2.5% процессора — величину, которую не
          поймает ни один порог, — а кадры стали вдвое длиннее. Проценты тут
          справка, а не повод: важен сам факт «его не было, а потом он был». */}
      {(appeared.length > 0 || gone.length > 0) && (
        <div className="changes" style={{ marginBottom: 12 }}>
          {appeared.map((program) => (
            <div key={`+${program.name}`} className="change">
              <span className="change-label">Появилась программа</span>
              <code>{program.name}</code>
              <span className="muted">{program.usualPercent}% CPU</span>
            </div>
          ))}
          {gone.map((program) => (
            <div key={`-${program.name}`} className="change">
              <span className="change-label">Больше не работала</span>
              <code>{program.name}</code>
              <span className="muted">было {program.usualPercent}% CPU</span>
            </div>
          ))}
        </div>
      )}

      {changes.length === 0 && appeared.length === 0 && gone.length === 0 ? (
        <div className="muted">
          Ничего не изменилось — либо настройки те же, либо записи сделаны до того, как приложение
          стало запоминать состояние машины. Во втором случае разницу в числах объяснить нечем.
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
            Ограничение производительности изменилось:{' '}
            {BOTTLENECK_LABEL[comparison.before.bottleneck]} →{' '}
            {BOTTLENECK_LABEL[comparison.after.bottleneck]}
          </div>
        )}
      </div>

      {/* Что менялось — сразу за вердиктом: без этого человек видит разницу в
          числах и вспоминает по памяти, чем он её вызвал. */}
      <WhatChanged
        changes={comparison.changes}
        appeared={comparison.programsAppeared}
        gone={comparison.programsGone}
      />

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
