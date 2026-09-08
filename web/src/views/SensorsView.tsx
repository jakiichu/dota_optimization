import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeToSensors, type GpuReadingView, type SensorSampleView } from '../api.ts';
import { UtilizationChart } from '../components/UtilizationChart.tsx';

/** Сколько замеров держим в графике: при 250 мс это две минуты истории. */
const HISTORY_LENGTH = 480;

const UNKNOWN = '—';

interface History {
  readonly time: number[];
  readonly utilizationByAdapter: Map<string, number[]>;
}

function emptyHistory(): History {
  return { time: [], utilizationByAdapter: new Map() };
}

/**
 * Копит историю замеров.
 *
 * История лежит в ref, а не в состоянии: перерисовка нужна на каждый замер, но
 * пересоздавать массивы длиной в сотни точек по четыре раза в секунду — нет.
 */
function useSensorHistory(): {
  latest: SensorSampleView | null;
  history: History;
  error: string | null;
} {
  const historyRef = useRef<History>(emptyHistory());
  const [latest, setLatest] = useState<SensorSampleView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToSensors(
      (sample) => {
        appendSample(historyRef.current, sample);
        setError(null);
        setLatest(sample);
      },
      (message) => setError(message),
    );
    return unsubscribe;
  }, []);

  return { latest, history: historyRef.current, error };
}

function appendSample(history: History, sample: SensorSampleView): void {
  history.time.push(sample.elapsedSeconds);
  if (history.time.length > HISTORY_LENGTH) history.time.shift();

  for (const gpu of sample.gpus) {
    let values = history.utilizationByAdapter.get(gpu.adapterName);
    if (values === undefined) {
      // Новый адаптер выравниваем нулями, иначе оси разъедутся по длине.
      values = new Array<number>(history.time.length - 1).fill(0);
      history.utilizationByAdapter.set(gpu.adapterName, values);
    }
    values.push(gpu.utilizationPercent ?? 0);
    if (values.length > HISTORY_LENGTH) values.shift();
  }
}

const CHART_COLORS = ['#4aa8ff', '#3fca7a', '#ffb340', '#a78bfa'];

export function SensorsView(): React.JSX.Element {
  const { latest, history, error } = useSensorHistory();

  const series = useMemo(
    () =>
      [...history.utilizationByAdapter.entries()].map(([label, values], index) => ({
        label,
        color: CHART_COLORS[index % CHART_COLORS.length] ?? '#4aa8ff',
        values,
      })),
    // Пересобираем на каждый замер: массивы мутируются на месте.
    [history, latest],
  );

  if (error !== null && latest === null) {
    return <div className="notice error">{error}</div>;
  }

  if (latest === null) {
    return <div className="notice">Жду первых замеров от сайдкара…</div>;
  }

  return (
    <>
      {error !== null && <div className="notice">{error}</div>}

      {history.time.length > 1 && (
        <div className="gpu-card" style={{ marginBottom: 12 }}>
          <div className="gpu-head">
            <span className="gpu-name">Загрузка 3D-движка</span>
            <span className="gpu-source">последние {HISTORY_LENGTH / 4} с</span>
          </div>
          <UtilizationChart time={history.time} series={series} maxY={100} unit=" %" />
        </div>
      )}

      <div className="gpu-grid">
        {latest.gpus.map((gpu) => (
          <GpuCard key={gpu.adapterName} gpu={gpu} color={colorOf(gpu.adapterName, series)} />
        ))}
      </div>

      {latest.errors.length > 0 && (
        <div className="errors">
          Недоступные источники:
          <ul>
            {latest.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Цвет карточки совпадает с линией на графике — иначе их не сопоставить. */
function colorOf(adapterName: string, series: readonly { label: string; color: string }[]): string {
  return series.find((entry) => entry.label === adapterName)?.color ?? 'var(--muted)';
}

function GpuCard({ gpu, color }: { gpu: GpuReadingView; color: string }): React.JSX.Element {
  return (
    <article className="gpu-card">
      <div className="gpu-head">
        <span className="dot" style={{ background: color }} />
        <span className="gpu-name" title={gpu.adapterName}>
          {gpu.displayName}
        </span>
        <span className="gpu-source">{gpu.source}</span>
      </div>

      <div className="metrics">
        <Metric label="загрузка" value={gpu.utilizationPercent} unit=" %" digits={1} />
        <Metric label="температура" value={gpu.temperatureC} unit=" °C" />
        <Metric label="частота ядра" value={gpu.coreClockMhz} unit=" МГц" />
        <Metric label="питание" value={gpu.powerWatts} unit=" Вт" digits={1} />
        <Metric label="видеопамять" value={gpu.memoryUsedMib} unit=" МиБ" />
      </div>

      {gpu.throttleReasons.length > 0 && (
        <div className="throttle">Троттлинг: {gpu.throttleReasons.join(', ')}</div>
      )}
    </article>
  );
}

/**
 * Прочерк вместо нуля — не косметика: «0 °C» читается как сломанный датчик, а
 * прочерк — как «мы это не читаем».
 */
function Metric({
  label,
  value,
  unit,
  digits = 0,
}: {
  label: string;
  value: number | null;
  unit: string;
  digits?: number;
}): React.JSX.Element {
  return (
    <div>
      <span className="metric-label">{label}</span>
      <span className={value === null ? 'metric-value unknown' : 'metric-value'}>
        {value === null ? UNKNOWN : `${value.toFixed(digits)}${unit}`}
      </span>
    </div>
  );
}
