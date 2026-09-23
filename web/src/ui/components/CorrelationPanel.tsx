import type { BackgroundProcess, Correlation } from '../../domain/models.ts';
import { EVIDENCE_COLOR } from '../../domain/presentation.ts';

/**
 * Цвет причины несёт смысл: красное — работа устройства заняла кадр целиком,
 * жёлтое — кадр ждал чего-то снаружи, синее — обстоятельства вокруг.
 */
export function CorrelationPanel({
  correlation,
  stutterCount,
  sensorSampleCount,
  background,
}: {
  correlation: Correlation;
  stutterCount: number;
  sensorSampleCount: number;
  background: readonly BackgroundProcess[];
}): React.JSX.Element {
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

      {/* Обстановка, а не улика, и стоит она отдельно от списка причин.
          Постоянная нагрузка одинакова в плохих кадрах и в хороших, а значит ни
          одного из них не объясняет — но на вопрос «что вообще крутилось»
          отвечает она, и молчать о шести процентах, съедаемых всю игру,
          странно. */}
      {background.length > 0 && (
        <div className="background-load">
          <div className="background-head">Занимали процессор всю запись</div>
          {background.map((entry) => (
            <div key={entry.name} className="background-row">
              <span className="background-name">{entry.name}</span>
              <span className="background-usual">{entry.usualPercent.toFixed(0)}%</span>
              <span className="muted">в пике {entry.peakPercent.toFixed(0)}%</span>
            </div>
          ))}
          <div className="muted">
            Ровная нагрузка ни один рывок не объясняет — она одинакова и в плохих кадрах, и в
            хороших. Но процессор она занимает.
          </div>
        </div>
      )}
    </div>
  );
}
