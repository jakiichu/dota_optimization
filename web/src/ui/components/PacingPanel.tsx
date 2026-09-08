import type { FramePacing } from '../../domain/models.ts';
import { PACING_COLOR, PACING_LABEL } from '../../domain/presentation.ts';

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

      <div className="bottleneck" style={{ color: PACING_COLOR[pacing.severity] }}>
        {PACING_LABEL[pacing.severity]}
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
