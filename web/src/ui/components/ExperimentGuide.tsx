import { useState } from 'react';
import {
  useGameConfig,
  useHypotheses,
  useHypothesisActions,
  useSessions,
} from '../../application/queries.ts';
import { experimentProgress } from '../../domain/experiment-progress.ts';
import type { ConfigChange, Hypothesis } from '../../domain/models.ts';
import { OUTCOME_COLOR } from '../../domain/presentation.ts';
import type { SectionId } from '../layout/Sidebar.tsx';
import { dateTime, seconds } from '../../domain/formatting.ts';

export function ExperimentGuide({
  onNavigate,
  onOpenInConfig,
}: {
  onNavigate: (section: SectionId) => void;
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element | null {
  const hypotheses = useHypotheses();
  const [selected, setSelected] = useState('');
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const available = hypotheses.data?.filter((h) => !dismissed.includes(h.id)) ?? [];
  const current =
    available.find((h) => h.id === selected) ??
    available.find((h) => h.check === null) ??
    available[0];
  if (hypotheses.isError)
    return (
      <div className="notice error">
        Не удалось загрузить текущие проверки.
        <button type="button" className="button" onClick={() => void hypotheses.refetch()}>
          Повторить
        </button>
      </div>
    );
  if (current === undefined) return null;

  return (
    <section className="card experiment-guide" aria-label="Проверка настройки">
      <div className="card-head">
        <span className="card-title">Проверка настройки</span>
        {available.length > 1 && (
          <label>
            Текущая проверка{' '}
            <select
              className="input"
              value={current.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {available.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.recommendation.title} · {dateTime(h.createdAt)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <GuideSteps
        key={current.id}
        hypothesis={current}
        onNavigate={onNavigate}
        onOpenInConfig={onOpenInConfig}
        onDismiss={() => setDismissed((ids) => [...ids, current.id])}
      />
    </section>
  );
}

function GuideSteps({
  hypothesis,
  onNavigate,
  onOpenInConfig,
  onDismiss,
}: {
  hypothesis: Hypothesis;
  onNavigate: (section: SectionId) => void;
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const config = useGameConfig();
  const sessions = useSessions();
  const { settle } = useHypothesisActions();
  const [chosen, setChosen] = useState('');
  const progress = experimentProgress(
    hypothesis,
    config.isError ? undefined : config.data?.settings,
    sessions.data ?? [],
  );
  const chosenId = progress.candidates.includes(chosen) ? chosen : (progress.candidates[0] ?? '');
  const byId = new Map(sessions.data?.map((session) => [session.id, session]));
  return (
    <>
      <p>
        <strong>{hypothesis.recommendation.title}</strong>
      </p>
      {hypothesis.before?.scene?.kind === 'replay' && (
        <p className="muted">
          Повтор: {hypothesis.before.scene.replayFile} · начальный тик:{' '}
          {hypothesis.before.scene.startTick ?? 'не указан'}.
        </p>
      )}
      <ol className="experiment-steps">
        <li>
          Исходная запись:{' '}
          {hypothesis.before === null
            ? 'не найдена'
            : `${hypothesis.before.label} · ${seconds(hypothesis.before.durationSeconds, 0)}`}
        </li>
        <li>
          Конфиг:{' '}
          {config.isError
            ? 'не удалось прочитать'
            : config.isPending
              ? 'проверяю файл…'
              : progress.saved
                ? 'предложенные значения уже в файле'
                : 'изменение ещё нужно сохранить'}
        </li>
        <li>Применить настройку в игре и записать ту же сцену</li>
        <li>
          Проверить результат:{' '}
          {hypothesis.check !== null
            ? 'готово'
            : progress.candidates.length > 0
              ? `найдено записей после начала проверки: ${progress.candidates.length}`
              : 'ждём повторный замер'}
        </li>
      </ol>
      {progress.step === 'missing-baseline' ? (
        <p className="muted">
          Исходная запись отсутствует. Сделайте новый замер и начните проверку из его рекомендаций.
        </p>
      ) : hypothesis.check !== null ? (
        <>
          <p style={{ color: OUTCOME_COLOR[hypothesis.check.outcome] }}>
            {hypothesis.check.summary}
          </p>
          {hypothesis.unexpected.length > 0 && (
            <p className="notice">
              Менялись и другие настройки: {hypothesis.unexpected.map((c) => c.label).join(', ')}.
              Эффект нельзя приписать только этой правке.
            </p>
          )}
          <p className="muted">
            Это результат одной пары. Для проверки повторяемости используйте «Сравнение → Повторные
            замеры».
          </p>
        </>
      ) : (
        <>
          <p className="muted">
            Сохранение файла не меняет уже запущенную игру. Перезапустите Dota перед повторным
            замером. Используйте тот же повтор, начальную точку, камеру и длительность. Меняйте по
            одной настройке.
          </p>
          {progress.step === 'compare' && (
            <div className="capture-form">
              <label>
                Запись после изменения
                <select
                  className="input"
                  value={chosenId}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {progress.candidates.map((id) => (
                    <option key={id} value={id}>
                      {byId.get(id)?.label ?? id} · {dateTime(byId.get(id)?.capturedAt ?? '')}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button primary"
                disabled={settle.isPending || chosenId === ''}
                onClick={() => settle.mutate({ id: hypothesis.id, afterSessionId: chosenId })}
              >
                {settle.isPending ? 'Проверяю…' : 'Проверить результат'}
              </button>
            </div>
          )}
          {config.isError && (
            <button type="button" className="button" onClick={() => void config.refetch()}>
              Перечитать конфиг
            </button>
          )}
          {sessions.isError && (
            <p className="notice error">
              Не удалось прочитать список записей.
              <button type="button" className="button" onClick={() => void sessions.refetch()}>
                Повторить
              </button>
            </p>
          )}
          {settle.isError && <p className="notice error">{settle.error.message}</p>}
        </>
      )}
      <div className="capture-form">
        {hypothesis.before !== null && hypothesis.check === null && (
          <>
            <button
              type="button"
              className={`button ${progress.step === 'config' ? 'primary' : ''}`}
              onClick={() => onOpenInConfig(hypothesis.recommendation.changes)}
            >
              Открыть изменение в конфиге
            </button>
            <button
              type="button"
              className={`button ${progress.step === 'capture' ? 'primary' : ''}`}
              onClick={() => onNavigate('capture')}
            >
              К повторной записи
            </button>
          </>
        )}
        <button type="button" className="button" onClick={() => onNavigate('compare')}>
          Все сравнения
        </button>
        <button type="button" className="button" onClick={onDismiss}>
          Скрыть подсказку
        </button>
      </div>
    </>
  );
}
