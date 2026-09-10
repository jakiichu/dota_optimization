import { useState } from 'react';
import { useHypotheses, useHypothesisActions, useSessions } from '../../application/queries.ts';
import { dateTime } from '../../domain/formatting.ts';
import type { Hypothesis, SessionSummary } from '../../domain/models.ts';
import { OUTCOME_COLOR, OUTCOME_LABEL } from '../../domain/presentation.ts';

/**
 * Проверка рекомендаций инструмента.
 *
 * Здесь он отвечает за свои слова. Каждая гипотеза несёт предсказание, сделанное
 * до правки, и приговор, посчитанный после неё — из тех же записей и по тем же
 * порогам, что и обычное сравнение.
 *
 * Приговор «не подтвердилась» важнее «подтвердилась». Инструмент, умеющий
 * только подтверждать, — это гайд по FPS с графиками.
 */
export function HypothesisPanel(): React.JSX.Element | null {
  const hypotheses = useHypotheses();
  const sessions = useSessions();

  if (hypotheses.data === undefined || hypotheses.data.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Проверка гипотез</span>
        <span className="card-note">что инструмент обещал и что вышло</span>
      </div>

      {hypotheses.data.map((hypothesis) => (
        <HypothesisRow
          key={hypothesis.id}
          hypothesis={hypothesis}
          sessions={sessions.data ?? []}
        />
      ))}
    </div>
  );
}

function HypothesisRow({
  hypothesis,
  sessions,
}: {
  hypothesis: Hypothesis;
  sessions: readonly SessionSummary[];
}): React.JSX.Element {
  const { settle, forget } = useHypothesisActions();
  const [chosen, setChosen] = useState('');

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const candidates = hypothesis.candidates;
  // Годная по сцене запись идёт первой: остальные инструмент всё равно
  // откажется сравнивать, и подсовывать их вперёд нечестно.
  const preferred = candidates.find((candidate) => candidate.comparable) ?? candidates[0];
  const chosenId = chosen === '' ? (preferred?.id ?? '') : chosen;

  return (
    <div className="hypothesis">
      <div className="hypothesis-head">
        <span className="hypothesis-title">{hypothesis.recommendation.title}</span>
        <span className="muted">{dateTime(hypothesis.createdAt)}</span>
        <button
          type="button"
          className="hypothesis-forget"
          title="Убрать гипотезу"
          aria-label="Убрать гипотезу"
          onClick={() => forget.mutate(hypothesis.id)}
        >
          ×
        </button>
      </div>

      <div className="hypothesis-expect">
        <span className="recommendation-mark">обещали</span>
        {hypothesis.recommendation.expect}
      </div>

      {hypothesis.check === null ? (
        <Pending
          hypothesis={hypothesis}
          byId={byId}
          chosenId={chosenId}
          onChoose={setChosen}
          pending={settle.isPending}
          onSettle={() =>
            settle.mutate({ id: hypothesis.id, afterSessionId: chosenId })
          }
        />
      ) : (
        <div
          className="hypothesis-verdict"
          style={{ color: OUTCOME_COLOR[hypothesis.check.outcome] }}
        >
          <b>{OUTCOME_LABEL[hypothesis.check.outcome]}</b>
          <span className="hypothesis-summary">{hypothesis.check.summary}</span>
        </div>
      )}

      {settle.isError && <div className="notice error">{settle.error.message}</div>}
    </div>
  );
}

/** Гипотеза ждёт второй записи: даём выбрать, какая из них «после». */
function Pending({
  hypothesis,
  byId,
  chosenId,
  onChoose,
  pending,
  onSettle,
}: {
  hypothesis: Hypothesis;
  byId: ReadonlyMap<string, SessionSummary>;
  chosenId: string;
  onChoose: (id: string) => void;
  pending: boolean;
  onSettle: () => void;
}): React.JSX.Element {
  if (hypothesis.before === null) {
    return (
      <div className="muted">
        Запись «до» удалена — проверять не с чем. Гипотезу можно убрать.
      </div>
    );
  }

  if (hypothesis.candidates.length === 0) {
    return (
      <div className="muted">
        Ждём вторую запись. Примените изменение и запишите ту же сцену ещё раз —
        повтор с того же тика.
      </div>
    );
  }

  return (
    <div className="hypothesis-settle">
      <span className="muted">запись «после»:</span>
      <select
        className="input"
        value={chosenId}
        onChange={(event) => onChoose(event.target.value)}
      >
        {hypothesis.candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {describe(byId.get(candidate.id), candidate.id)}
            {candidate.comparable ? '' : ' · другая сцена'}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button primary"
        disabled={pending || chosenId === ''}
        onClick={onSettle}
      >
        {pending ? 'Считаю…' : 'Проверить'}
      </button>
    </div>
  );
}

function describe(session: SessionSummary | undefined, fallback: string): string {
  if (session === undefined) return fallback;
  const label = session.label === '' ? session.id : session.label;
  return `${label} · ${dateTime(session.capturedAt)}`;
}
