import { useEffect, useState } from 'react';
import { useRunCapture } from '../../application/queries.ts';
import type { Capture, ConfigChange } from '../../domain/models.ts';
import { BOTTLENECK_COLOR, BOTTLENECK_LABEL } from '../../domain/presentation.ts';
import { ms, seconds } from '../../domain/formatting.ts';
import { CorrelationPanel } from '../components/CorrelationPanel.tsx';
import { FrameTimeChart } from '../components/FrameTimeChart.tsx';
import { PacingPanel } from '../components/PacingPanel.tsx';
import { RecommendationPanel } from '../components/RecommendationPanel.tsx';
import { ReplayRunPanel } from '../components/ReplayRunPanel.tsx';
import { EmptyState, ErrorState, SectionHeader } from '../components/States.tsx';

const DEFAULT_PROCESS = 'dota2.exe';
const DURATIONS = [15, 30, 60, 120] as const;

export function CaptureSection({
  onOpenInConfig,
}: {
  /** Уйти в редактор конфига с подставленным изменением из рекомендации. */
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element {
  const [processName, setProcessName] = useState(DEFAULT_PROCESS);
  const [durationSeconds, setDurationSeconds] = useState<number>(30);
  // Подпись нужна, чтобы через полчаса отличить «до HAGS» от «после».
  const [label, setLabel] = useState('');

  const capture = useRunCapture();
  const remaining = useCountdown(capture.isPending ? durationSeconds : null);

  return (
    <>
      <SectionHeader
        title="Запись кадров"
        subtitle="сколько длится каждый кадр и почему иногда дольше обычного"
      />

      {/* Сцена задаётся до записи, а не описывается после: порядок на экране
          повторяет порядок действий. */}
      <ReplayRunPanel />

      <div className="capture-form">
        <label>
          <span className="metric-label">процесс</span>
          <input
            className="input"
            value={processName}
            onChange={(event) => setProcessName(event.target.value)}
            disabled={capture.isPending}
          />
        </label>
        <label>
          <span className="metric-label">длительность</span>
          <select
            className="input"
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(Number(event.target.value))}
            disabled={capture.isPending}
          >
            {DURATIONS.map((value) => (
              <option key={value} value={value}>
                {value} с
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="metric-label">подпись</span>
          <input
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="например, до отключения MPO"
            disabled={capture.isPending}
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={capture.isPending}
          onClick={() =>
            capture.mutate({ processName, seconds: durationSeconds, label })
          }
        >
          {capture.isPending ? `Записываю… ${Math.max(remaining ?? 0, 0)} с` : 'Записать'}
        </button>
      </div>

      {capture.isPending && (
        <EmptyState>
          Игра должна быть запущена и рисовать. PresentMon требует прав администратора —
          если появился запрос UAC, подтвердите его.
        </EmptyState>
      )}

      {capture.isError && <ErrorState message={capture.error.message} />}
      {capture.data !== undefined && (
        <CaptureReport capture={capture.data} onOpenInConfig={onOpenInConfig} />
      )}
    </>
  );
}

/**
 * Обратный отсчёт до конца записи.
 *
 * Чисто клиентский: PresentMon о прогрессе не сообщает, но длительность мы
 * задали сами, так что показать её честно можно.
 */
function useCountdown(totalSeconds: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (totalSeconds === null) {
      setRemaining(null);
      return undefined;
    }
    setRemaining(totalSeconds);
    const timer = setInterval(() => {
      setRemaining((value) => (value === null ? null : Math.max(value - 1, 0)));
    }, 1000);
    return () => clearInterval(timer);
  }, [totalSeconds]);

  return remaining;
}

function CaptureReport({
  capture,
  onOpenInConfig,
}: {
  capture: Capture;
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element {
  if (capture.frameCount === 0) {
    return (
      <EmptyState>
        Кадров не записано: процесс {capture.application} не рисовал в это время.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">{capture.application}</span>
          <span className="card-note">
            {capture.frameCount} кадров за {seconds(capture.durationSeconds)}
          </span>
        </div>
        <FrameTimeChart series={capture.series} />
      </div>

      <div className="card">
        <div className="metrics">
          <Metric label="средний FPS" value={capture.averageFps.toFixed(1)} />
          <Metric label="медиана" value={ms(capture.frameTime.p50)} />
          <Metric label="p95" value={ms(capture.frameTime.p95)} />
          <Metric label="p99" value={ms(capture.frameTime.p99)} />
          <Metric label="p99.9" value={ms(capture.frameTime.p999)} />
          {capture.inputLatency !== null && (
            <Metric label="инпут-лаг p99" value={ms(capture.inputLatency.p99)} />
          )}
          <Metric
            label="статтеры"
            value={`${capture.stutterCount} (${capture.stuttersPerMinute.toFixed(1)}/мин)`}
          />
        </div>
        <div
          className="verdict"
          style={{ color: BOTTLENECK_COLOR[capture.bottleneck.kind] }}
        >
          {BOTTLENECK_LABEL[capture.bottleneck.kind]}
        </div>
        <div className="muted">{capture.bottleneck.explanation}</div>
      </div>

      <PacingPanel pacing={capture.pacing} />

      {capture.stutterCount > 0 && (
        <CorrelationPanel
          correlation={capture.correlation}
          stutterCount={capture.stutterCount}
          sensorSampleCount={capture.sensorSampleCount}
        />
      )}

      {capture.network.measured && <NetworkPanel capture={capture} />}

      {/* Рекомендации последними: сначала числа, потом выводы из них. Обратный
          порядок читается как советы, к которым для солидности приложили графики. */}
      <RecommendationPanel
        recommendations={capture.recommendations}
        sessionId={capture.sessionId}
        onOpenInConfig={onOpenInConfig}
      />
    </>
  );
}

/**
 * Сеть отдельной карточкой, а не среди улик по кадрам: она не удлиняет кадр,
 * но даёт на экране такой же рывок.
 */
function NetworkPanel({ capture }: { capture: Capture }): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Сеть</span>
      </div>
      <div className="muted">{capture.network.summary}</div>
      <table className="table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>узел</th>
            <th>задержка</th>
            <th>дрожание</th>
            <th>потери</th>
          </tr>
        </thead>
        <tbody>
          {capture.network.targets.map((target) => (
            <tr key={target.target}>
              <td>
                {target.label}
                <span className="muted"> · {target.target}</span>
              </td>
              <td>{ms(target.medianMs, 0)}</td>
              <td>{ms(target.jitterMs)}</td>
              <td>{(target.lossShare * 100).toFixed(1)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
