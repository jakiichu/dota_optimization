import type { ConfigChange, Recommendation } from '../../domain/models.ts';
import { CONFIDENCE_LABEL } from '../../domain/presentation.ts';

/**
 * Что попробовать поменять — по числам из этой записи.
 *
 * Карточка устроена так, чтобы её нельзя было прочитать как совет из
 * интернета. Сверху повод с цифрами, ниже само изменение, а в конце —
 * предсказание: что должно сдвинуться, если гипотеза верна. Именно
 * предсказание делает рекомендацию опровержимой, и убирать его ради краткости
 * нельзя — без него остаётся обещание.
 *
 * Рядом всегда цена. Ограничение кадров стоит инпут-лага, снятие нагрузки —
 * качества картинки, и умолчать об этом значило бы продавать, а не измерять.
 */
export function RecommendationPanel({
  recommendations,
  onOpenInConfig,
}: {
  recommendations: readonly Recommendation[];
  /** Перейти в редактор конфига с уже подставленным изменением. */
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element | null {
  if (recommendations.length === 0) return null;

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
            <button
              type="button"
              className="button primary"
              onClick={() => onOpenInConfig(item.changes)}
            >
              Открыть в конфиге
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
