import { useEffect, useRef, useState } from 'react';
import { runCapture, type BottleneckKind, type CaptureView as CaptureData } from '../api.ts';
import { CorrelationPanel } from '../components/CorrelationPanel.tsx';
import { FrameTimeChart } from '../components/FrameTimeChart.tsx';
import { PacingPanel } from '../components/PacingPanel.tsx';

const DEFAULT_PROCESS = 'dota2.exe';
const DURATIONS = [15, 30, 60, 120] as const;

const BOTTLENECK_LABEL: Record<BottleneckKind, string> = {
  gpu: 'Упор в видеокарту',
  cpu: 'Упор в процессор',
  mixed: 'Ограничитель меняется',
  limited: 'Работает ограничитель кадров',
  unknown: 'Определить не удалось',
};

const BOTTLENECK_COLOR: Record<BottleneckKind, string> = {
  gpu: 'var(--ok)',
  cpu: 'var(--warning)',
  mixed: 'var(--info)',
  limited: 'var(--info)',
  unknown: 'var(--unknown)',
};

export function CaptureView(): React.JSX.Element {
  const [processName, setProcessName] = useState(DEFAULT_PROCESS);
  const [seconds, setSeconds] = useState<number>(30);
  // Подпись нужна, чтобы через полчаса отличить «до HAGS» от «после».
  const [label, setLabel] = useState('');
  const [data, setData] = useState<CaptureData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const running = remaining !== null;

  // Обратный отсчёт чисто клиентский: PresentMon не сообщает о прогрессе, но
  // длительность мы задали сами, так что показать её честно можно.
  useEffect(() => {
    if (remaining === null) return undefined;
    if (remaining <= 0) return undefined;
    const timer = setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  useEffect(() => () => abort.current?.abort(), []);

  const start = (): void => {
    const controller = new AbortController();
    abort.current = controller;

    setError(null);
    setData(null);
    setRemaining(seconds);

    runCapture(processName, seconds, label, controller.signal)
      .then(setData)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setRemaining(null));
  };

  return (
    <>
      <div className="capture-form">
        <label>
          <span className="metric-label">процесс</span>
          <input
            className="input"
            value={processName}
            onChange={(event) => setProcessName(event.target.value)}
            disabled={running}
          />
        </label>
        <label>
          <span className="metric-label">длительность</span>
          <select
            className="input"
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
            disabled={running}
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
            disabled={running}
          />
        </label>
        <button type="button" className="button" onClick={start} disabled={running}>
          {running ? `Записываю… ${Math.max(remaining, 0)} с` : 'Записать'}
        </button>
      </div>

      {running && (
        <div className="notice">
          Игра должна быть запущена и рисовать. PresentMon требует прав администратора —
          если появился запрос UAC, подтвердите его.
        </div>
      )}

      {error !== null && <div className="notice error">{error}</div>}

      {data !== null && <CaptureReport data={data} />}
    </>
  );
}

function CaptureReport({ data }: { data: CaptureData }): React.JSX.Element {
  if (data.frameCount === 0) {
    return (
      <div className="notice">
        Кадров не записано: процесс {data.application} не рисовал в это время.
      </div>
    );
  }

  return (
    <>
      <div className="gpu-card" style={{ marginBottom: 12 }}>
        <div className="gpu-head">
          <span className="gpu-name">{data.application}</span>
          <span className="gpu-source">
            {data.frameCount} кадров за {data.durationSeconds.toFixed(1)} с
          </span>
        </div>
        <FrameTimeChart series={data.series} />
      </div>

      <div className="gpu-card" style={{ marginBottom: 12 }}>
        <div className="metrics">
          <Metric label="средний FPS" value={data.averageFps.toFixed(1)} />
          <Metric label="медиана" value={ms(data.frameTime.p50)} />
          <Metric label="p95" value={ms(data.frameTime.p95)} />
          <Metric label="p99" value={ms(data.frameTime.p99)} />
          <Metric label="p99.9" value={ms(data.frameTime.p999)} />
          {data.inputLatency !== null && (
            <Metric label="инпут-лаг p99" value={ms(data.inputLatency.p99)} />
          )}
          <Metric
            label="статтеры"
            value={`${data.stutterCount} (${data.stuttersPerMinute.toFixed(1)}/мин)`}
          />
        </div>
        <div className="bottleneck" style={{ color: BOTTLENECK_COLOR[data.bottleneck.kind] }}>
          {BOTTLENECK_LABEL[data.bottleneck.kind]}
        </div>
        <div className="finding-summary">{data.bottleneck.explanation}</div>
      </div>

      <PacingPanel pacing={data.pacing} />

      {data.stutterCount > 0 && (
        <CorrelationPanel
          correlation={data.correlation}
          stutterCount={data.stutterCount}
          sensorSampleCount={data.sensorSampleCount}
        />
      )}

      {data.worstStutters.length > 0 && (
        <div className="gpu-card">
          <div className="gpu-head">
            <span className="gpu-name">Самые длинные кадры</span>
          </div>
          <table className="stutters">
            <thead>
              <tr>
                <th>когда</th>
                <th>кадр</th>
                <th>норма рядом</th>
                <th>во сколько раз</th>
              </tr>
            </thead>
            <tbody>
              {data.worstStutters.map((stutter) => (
                <tr key={stutter.atSeconds}>
                  <td>{stutter.atSeconds.toFixed(2)} с</td>
                  <td>{ms(stutter.frameTimeMs)}</td>
                  <td>{ms(stutter.baselineMs)}</td>
                  <td>×{stutter.ratio.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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

function ms(value: number): string {
  return `${value.toFixed(1)} мс`;
}
