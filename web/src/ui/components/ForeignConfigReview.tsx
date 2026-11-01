import { useState } from 'react';
import type { ConfigReview, ConfigReviewLine } from '../../domain/models.ts';
import { IMPACT_COLOR, NOTE_COLOR, REVIEW_VERDICT_LABEL } from '../../domain/presentation.ts';

/**
 * Чужой конфиг, разобранный против своего, — до записи.
 *
 * Строки делятся на три стопки по тому, что они сделают у вас: поменяют,
 * не поменяют ничего, или вовсе не настройки. Переносится в черновик только
 * отмеченное, и по умолчанию не отмечено ничего: «взять всё из гайда» — ровно
 * то, от чего инструмент уводит, и делать это решение за человека нельзя.
 */
export function ForeignConfigReview({
  review,
  onTake,
}: {
  review: ConfigReview;
  /** Отмеченные строки — в черновик. Файл при этом не трогается. */
  onTake: (changes: Record<string, string>) => void;
}): React.JSX.Element {
  const effective = review.lines.filter(
    (line) => line.verdict === 'changes' || line.verdict === 'adds',
  );
  const idle = review.lines.filter(
    (line) => line.verdict === 'already' || line.verdict === 'shadowed',
  );
  const commands = review.lines.filter((line) => line.verdict === 'command');

  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [taken, setTaken] = useState(0);

  const toggle = (line: number): void =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const take = (): void => {
    const chosen = effective.filter((line) => picked.has(line.line));
    onTake(Object.fromEntries(chosen.map((line) => [line.name, line.value])));
    setTaken(chosen.length);
    setPicked(new Set());
  };

  return (
    <div className="review">
      <div className="summary">
        <span className="chip" aria-pressed="true">
          поменяют у вас: {review.effective}
        </span>
        <span className="chip" aria-pressed="true">
          не поменяют ничего: {review.idle}
        </span>
        {commands.length > 0 && (
          <span className="chip" aria-pressed="true">
            команды: {commands.length}
          </span>
        )}
        {review.tally.map((entry) => (
          <span key={entry.impact} className="chip" aria-pressed="true">
            <span className="dot" style={{ background: IMPACT_COLOR[entry.impact] }} />
            {entry.label} — {entry.count}
          </span>
        ))}
      </div>

      {!review.ownExists && (
        <div className="muted">
          Своего конфига у вас нет, поэтому сравнивать не с чем: всё, что не перекрыто, добавится.
        </div>
      )}

      {review.notes.map((note) => (
        <div
          key={note.title}
          className="review-note"
          style={{ borderLeft: `3px solid ${NOTE_COLOR[note.severity]}` }}
        >
          <strong>{note.title}.</strong> {note.detail}
        </div>
      ))}

      {effective.length > 0 && (
        <>
          <div className="review-head">
            <span className="card-title">Поменяют у вас</span>
            <button
              type="button"
              className="button"
              onClick={() =>
                setPicked(
                  picked.size === effective.length
                    ? new Set()
                    : new Set(effective.map((line) => line.line)),
                )
              }
            >
              {picked.size === effective.length ? 'Снять отметки' : 'Отметить все'}
            </button>
          </div>
          <div className="settings">
            {effective.map((line) => (
              <ReviewRow
                key={line.line}
                line={line}
                picked={picked.has(line.line)}
                onToggle={() => toggle(line.line)}
              />
            ))}
          </div>
          <div className="config-actions">
            <button
              type="button"
              className="button primary"
              disabled={picked.size === 0}
              onClick={take}
            >
              В черновик ({picked.size})
            </button>
            {taken > 0 && (
              <span className="muted">
                Перенесено строк: {taken}. Они в черновике наверху раздела — файл пока не тронут.
              </span>
            )}
          </div>
        </>
      )}

      {idle.length > 0 && (
        <details className="review-idle">
          <summary>Не поменяют ничего — {idle.length}</summary>
          <div className="muted">
            Гайд может обещать за них кадры, но движок их не заметит: значение у вас уже такое, или
            ниже в том же конфиге стоит строка, которая его перебивает.
          </div>
          <div className="settings">
            {idle.map((line) => (
              <ReviewRow key={line.line} line={line} picked={null} onToggle={() => {}} />
            ))}
          </div>
        </details>
      )}

      {commands.length > 0 && (
        <details className="review-idle">
          <summary>Команды — {commands.length}</summary>
          <div className="muted">
            Бинды, псевдонимы и вызовы других файлов — не настройки, в черновик они не ложатся. Если
            нужны, перепишите их в конфиг руками.
          </div>
          <ul className="steps">
            {commands.map((line) => (
              <li key={line.line}>
                <code>
                  {line.name} {line.value}
                </code>
              </li>
            ))}
          </ul>
        </details>
      )}

      {review.unparsed.length > 0 && (
        <details className="review-idle">
          <summary>Не разобрались — {review.unparsed.length}</summary>
          <div className="muted">
            Это не похоже на «настройка значение». Движок такие строки, скорее всего, тоже
            пропустит.
          </div>
          <ul className="steps">
            {review.unparsed.map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReviewRow({
  line,
  picked,
  onToggle,
}: {
  line: ConfigReviewLine;
  /** `null` — строку перенести нельзя, отметки нет. */
  picked: boolean | null;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <label className="setting review-row" data-changed={picked === true}>
      <div className="setting-main">
        {picked !== null && <input type="checkbox" checked={picked} onChange={onToggle} />}
        <div className="setting-name">
          <code>{line.name}</code>
        </div>
        <code className="review-value">
          {line.ownValue !== null && line.verdict === 'changes' ? (
            <>
              <s>{line.ownValue}</s> → {line.value}
            </>
          ) : (
            line.value
          )}
        </code>
      </div>
      {line.inGame !== null && (
        <div className="setting-ingame">
          в меню игры — «{line.inGame.label}»
          {line.inGame.inverted && (
            <span className="setting-inverted">
              значение обратное: <code>1</code> здесь — это галочка снята
            </span>
          )}
        </div>
      )}
      <div className="setting-explain">
        <span className="setting-what">{REVIEW_VERDICT_LABEL[line.verdict]}</span>
        {line.what !== null && <span className="setting-what">{line.what}</span>}
        <span className="setting-impact" style={{ color: IMPACT_COLOR[line.impact] }}>
          {line.impactLabel}
        </span>
        {line.cost !== null && <span className="setting-cost">цена: {line.cost}</span>}
        <span className="setting-line">строка {line.line}</span>
      </div>
    </label>
  );
}
