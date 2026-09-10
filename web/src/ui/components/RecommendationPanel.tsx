import { useHypothesisActions } from '../../application/queries.ts';
import type { ConfigChange, Recommendation } from '../../domain/models.ts';
import { CONFIDENCE_LABEL } from '../../domain/presentation.ts';

/**
 * Что попробовать поменять — по числам из этой записи.
 *
 * Карточка устроена так, чтобы её нельзя было прочитать как совет из
 * интернета. Сверху повод с цифрами, ниже само изменение, а в конце —
 * предсказание: что должно сдвинуться, если гипотеза верна.
 *
 * И кнопка «Проверить» рядом с ним. Предсказание, которое никто не проверяет,
 * ничем не отличается от обещания: до неё инструмент говорил «ожидаем, что
 * ритм выровняется» и умолкал навсегда.
 */
export function RecommendationPanel({
  recommendations,
  sessionId,
  onOpenInConfig,
}: {
  recommendations: readonly Recommendation[];
  /** Запись, из которой рекомендации: она станет «до» у гипотезы. */
  sessionId: string;
  /** Перейти в редактор конфига с уже подставленным изменением. */
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element | null {
  const { record } = useHypothesisActions();

  if (recommendations.length === 0) return null;

  const trackedKind = record.isSuccess ? record.variables?.kind : undefined;

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Что попробовать</span>
        <span className="card-note">выводы из этой записи, а не советы вообще</span>
      </div>

      {recommendations.map((item) => (
        <div key={item.title} className="recommendation">
          <div className="recommendation-head">
            <span className="recommendation-title">{item.title}</span>
            <span className="recommendation-confidence">{CONFIDENCE_LABEL[item.confidence]}</span>
          </div>

          <div className="recommendation-evidence">
            <span className="recommendation-mark">почему</span>
            {item.evidence}
          </div>

          {item.changes.length > 0 && (
            <div className="recommendation-changes">
              {item.changes.map((change) => (
                <div key={change.cvar} className="recommendation-change">
                  <code>
                    {change.cvar} {change.value}
                  </code>
                  <span className="muted">{change.why}</span>
                </div>
              ))}
            </div>
          )}

          {/* Как проверить — обязательная часть. Без неё рекомендацию нельзя
              опровергнуть, и она ничем не отличается от совета из интернета. */}
          <div className="recommendation-expect">
            <span className="recommendation-mark">как проверить</span>
            {item.expect}
          </div>
          {item.risk !== '' && (
            <div className="recommendation-risk">
              <span className="recommendation-mark">чем платите</span>
              {item.risk}
            </div>
          )}

          {item.changes.length > 0 && (
            <div className="recommendation-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => onOpenInConfig(item.changes)}
              >
                Открыть в конфиге
              </button>

              {item.prediction !== null &&
                (trackedKind === item.kind ? (
                  <span className="muted">
                    Гипотеза заведена. Примените изменение, запишите ту же сцену ещё раз
                    и проверьте её в разделе «Сравнение».
                  </span>
                ) : (
                  <button
                    type="button"
                    className="button"
                    disabled={record.isPending}
                    onClick={() => record.mutate({ sessionId, kind: item.kind })}
                  >
                    Проверить это
                  </button>
                ))}
            </div>
          )}
        </div>
      ))}

      {record.isError && <div className="notice error">{record.error.message}</div>}
    </div>
  );
}
