import { useState } from 'react';
import type { Correlation } from '../../domain/models.ts';
import { EVIDENCE_COLOR } from '../../domain/presentation.ts';

/**
 * Цвет причины несёт смысл: красное — работа устройства заняла кадр целиком,
 * жёлтое — кадр ждал чего-то снаружи, синее — обстоятельства вокруг.
 */
/** Сколько разобранных статтеров показываем: остальные видны в сводке. */
const DETAILED_STUTTERS = 8;

export function CorrelationPanel({
  correlation,
  stutterCount,
  sensorSampleCount,
}: {
  correlation: Correlation;
  stutterCount: number;
  sensorSampleCount: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const explained = correlation.stutters.filter((entry) => entry.evidence.length > 0);
  const shown = expanded ? explained : explained.slice(0, DETAILED_STUTTERS);

  return (
    <div className="gpu-card" style={{ marginBottom: 12 }}>
      <div className="gpu-head">
        <span className="gpu-name">С чем совпали статтеры</span>
        <span className="gpu-source">{sensorSampleCount} замеров сенсоров за запись</span>
      </div>

      {correlation.tally.length === 0 ? (
        <div className="finding-summary">Ни одной улики не нашлось.</div>
      ) : (
        <div className="tally">
          {correlation.tally.map((cause) => (
            <div key={cause.kind} className="tally-row">
              <span className="dot" style={{ background: EVIDENCE_COLOR[cause.kind] }} />
              <span className="tally-count">
                {cause.count} из {stutterCount}
              </span>
              <span>{cause.label}</span>
            </div>
          ))}
          {correlation.unexplained > 0 && (
            <div className="tally-row">
              <span className="dot" style={{ background: 'var(--muted)' }} />
              <span className="tally-count">{correlation.unexplained}</span>
              <span>без объяснения</span>
            </div>
          )}
        </div>
      )}

      {/* Нехватка данных и отсутствие причин — разные вещи; вторую нельзя
          выдавать за первую. */}
      {correlation.limitations.length > 0 && (
        <div className="errors">
          Чего не хватило:
          <ul>
            {correlation.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      )}

      {shown.length > 0 && (
        <table className="stutters" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>когда</th>
              <th>кадр</th>
              <th>что происходило рядом</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry) => (
              <tr key={entry.stutter.frameIndex}>
                <td>{entry.stutter.atSeconds.toFixed(2)} с</td>
                <td>{entry.stutter.frameTimeMs.toFixed(1)} мс</td>
                <td>
                  {entry.evidence.map((item) => (
                    <div key={item.kind} className="evidence">
                      <span className="dot" style={{ background: EVIDENCE_COLOR[item.kind] }} />
                      {item.detail}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {explained.length > DETAILED_STUTTERS && (
        <button
          type="button"
          className="button"
          style={{ marginTop: 12 }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Свернуть' : `Показать все ${explained.length}`}
        </button>
      )}
    </div>
  );
}
