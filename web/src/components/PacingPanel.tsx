import type { FramePacing, PacingSeverity } from '../api.ts';

const SEVERITY_COLOR: Record<PacingSeverity, string> = {
  ok: 'var(--ok)',
  noticeable: 'var(--warning)',
  bad: 'var(--critical)',
};

const SEVERITY_LABEL: Record<PacingSeverity, string> = {
  ok: 'Ритм ровный',
  noticeable: 'Ритм заметно рваный',
  bad: 'Ритм рваный',
};

/**
 * Ровность ритма отдельной карточкой.
 *
 * Не среди прочих чисел: на живой записи Dota именно рваный ритм оказался
 * главной проблемой, а средний FPS и число статтеров выглядели прилично.
 */
export function PacingPanel({ pacing }: { pacing: FramePacing }): React.JSX.Element {
  return (
    <div className="gpu-card" style={{ marginBottom: 12 }}>
      <div className="gpu-head">
        <span className="gpu-name">Ритм кадров</span>
        <span className="gpu-source">
          базовый интервал {pacing.baseIntervalMs.toFixed(1)} мс ·{' '}
          {pacing.impliedHz.toFixed(0)} кадров в секунду
          {pacing.nearestCommonHz !== null && ` · похоже на ${pacing.nearestCommonHz} Гц`}
        </span>
      </div>

      <div className="bottleneck" style={{ color: SEVERITY_COLOR[pacing.severity] }}>
        {SEVERITY_LABEL[pacing.severity]}
      </div>
      <div className="finding-summary">{pacing.summary}</div>

      {pacing.multiples.length > 0 && (
        <div className="metrics" style={{ marginTop: 12 }}>
          {pacing.multiples.map((entry) => (
            <div key={entry.multiple}>
              <span className="metric-label">кадров в {entry.multiple} раза длиннее</span>
              <span className="metric-value">
                {(entry.share * 100).toFixed(1)} %
              </span>
            </div>
          ))}
          <div>
            <span className="metric-label">времени потеряно</span>
            <span className="metric-value">
              {(pacing.timeShareInLongFrames * 100).toFixed(0)} %
            </span>
          </div>
          <div>
            <span className="metric-label">колебание кадров</span>
            <span className="metric-value">{(pacing.oscillation * 100).toFixed(0)} %</span>
          </div>
        </div>
      )}
    </div>
  );
}
