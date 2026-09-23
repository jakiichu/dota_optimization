import type { StutterInspection } from '../../domain/stutter-inspection.ts';
import { EVIDENCE_COLOR } from '../../domain/presentation.ts';
import { ms } from '../../domain/formatting.ts';

export function StutterInspector({
  stutters,
  selectedFrameIndex,
  onSelect,
}: {
  stutters: readonly StutterInspection[];
  selectedFrameIndex: number | null;
  onSelect: (stutter: StutterInspection) => void;
}): React.JSX.Element | null {
  if (stutters.length === 0) return null;
  const selected =
    stutters.find((entry) => entry.stutter.frameIndex === selectedFrameIndex) ?? stutters[0]!;

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Разбор отдельного рывка</span>
        <span className="card-note">самые длинные кадры</span>
      </div>
      <ol className="stutter-inspector-list" aria-label="Самые длинные статтеры">
        {stutters.map((entry, index) => (
          <li key={entry.stutter.frameIndex}>
            <button
              type="button"
              className="stutter-inspector-item"
              aria-current={entry.stutter.frameIndex === selected.stutter.frameIndex}
              aria-label={`Рывок ${index + 1}: ${ms(entry.stutter.frameTimeMs)}, ${entry.stutter.atSeconds.toFixed(1)} секунды`}
              onClick={() => onSelect(entry)}
            >
              <span>#{index + 1}</span>
              <strong>{ms(entry.stutter.frameTimeMs)}</strong>
              <span>{entry.stutter.atSeconds.toFixed(1)} с</span>
              <span className="dot" style={{ background: colorOf(entry.primaryKind) }} />
            </button>
          </li>
        ))}
      </ol>
      <div className="stutter-inspector-detail" aria-live="polite">
        <div className="metrics">
          <Metric label="момент" value={`${selected.stutter.atSeconds.toFixed(2)} с`} />
          <Metric label="длительность" value={ms(selected.stutter.frameTimeMs)} />
          <Metric label="обычный кадр рядом" value={ms(selected.stutter.baselineMs)} />
          <Metric label="длиннее обычного" value={`${selected.stutter.ratio.toFixed(1)}×`} />
        </div>
        {selected.evidence.length === 0 ? (
          <p>Совпавших событий не найдено.</p>
        ) : (
          <ul>
            {selected.evidence.map((evidence) => (
              <li key={`${evidence.kind}:${evidence.detail}`}>
                <span className="dot" style={{ background: EVIDENCE_COLOR[evidence.kind] }} />
                {evidence.detail}
              </li>
            ))}
          </ul>
        )}
        {selected.relatedRecommendation !== null && selected.recommendationAnchor !== null && (
          <div className="stutter-next-check">
            <span className="recommendation-mark">что проверить дальше</span>
            <strong>{selected.relatedRecommendation.title}</strong>
            <span>{selected.relatedRecommendation.expect}</span>
            <a className="button" href={`#${selected.recommendationAnchor}`}>
              Открыть проверку ниже
            </a>
            <span className="muted">
              Рекомендация рассчитана по всей записи, а не по одному кадру.
            </span>
          </div>
        )}
        <p className="muted">
          Эти события совпали с рывком во времени. Совпадение помогает выбрать следующую проверку,
          но само по себе не доказывает причину.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

function colorOf(kind: StutterInspection['primaryKind']): string {
  return kind === null ? 'var(--muted)' : EVIDENCE_COLOR[kind];
}
