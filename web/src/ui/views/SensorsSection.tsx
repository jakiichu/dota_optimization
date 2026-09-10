import { useMemo } from 'react';
import {
  SENSOR_HISTORY_SECONDS,
  useSensorStream,
} from '../../application/use-sensor-stream.ts';
import type { GpuReading, SensorSample } from '../../domain/models.ts';
import { mib, ms, percent, UNKNOWN } from '../../domain/formatting.ts';
import { UtilizationChart } from '../components/UtilizationChart.tsx';
import { EmptyState, ErrorState, SectionHeader } from '../components/States.tsx';

const CHART_COLORS = ['#4aa8ff', '#3fca7a', '#ffb340', '#a78bfa'];

export function SensorsSection(): React.JSX.Element {
  const { latest, history, error } = useSensorStream();

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
    return <ErrorState message={error} />;
  }

  if (latest === null) {
    return (
      <>
        <SectionHeader title="Сенсоры" subtitle="живые показания" />
        <EmptyState>Жду первых замеров от сайдкара…</EmptyState>
      </>
    );
  }

  return (
    <>
      <SectionHeader title="Сенсоры" subtitle="живые показания" />

      {error !== null && <EmptyState>{error}</EmptyState>}

      {history.time.length > 1 && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Загрузка 3D-движка</span>
            <span className="card-note">последние {SENSOR_HISTORY_SECONDS} с</span>
          </div>
          <UtilizationChart time={history.time} series={series} maxY={100} unit=" %" />
        </div>
      )}

      {latest.cpu !== null && <CpuCard cpu={latest.cpu} />}

      {latest.gpus.map((gpu, index) => (
        <GpuCard
          key={gpu.adapterName}
          gpu={gpu}
          color={CHART_COLORS[index % CHART_COLORS.length] ?? 'var(--muted)'}
        />
      ))}

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

function GpuCard({
  gpu,
  color,
}: {
  gpu: GpuReading;
  color: string;
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className="dot" style={{ background: color }} />
        <span className="card-title" title={gpu.adapterName}>
          {gpu.displayName}
        </span>
        <span className="card-note">{gpu.source}</span>
      </div>

      <div className="metrics">
        <Metric label="загрузка" value={percent(gpu.utilizationPercent)} />
        <Metric label="температура" value={degrees(gpu.temperatureC)} />
        <Metric label="частота ядра" value={megahertz(gpu.coreClockMhz)} />
        <Metric label="питание" value={watts(gpu.powerWatts)} />
        <Metric label="видеопамять" value={mib(gpu.memoryUsedMib)} />
      </div>

      {gpu.throttleReasons.length > 0 && (
        <div className="throttle">Троттлинг: {gpu.throttleReasons.join(', ')}</div>
      )}
    </div>
  );
}

function degrees(value: number | null): string {
  return value === null ? '—' : `${value} °C`;
}

function megahertz(value: number | null): string {
  return value === null ? '—' : `${value} МГц`;
}

function watts(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} Вт`;
}

/** Прочерк вместо нуля: «0 °C» читается как сломанный датчик. */
function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  const unknown = value === '—' || value === ms(null);
  return (
    <div>
      <span className="metric-label">{label}</span>
      <span className={unknown ? 'metric-value unknown' : 'metric-value'}>{value}</span>
    </div>
  );
}

/**
 * Живые показания процессора.
 *
 * «Занято 4 потока из 16» говорит то, чего не говорят проценты: поможет ли
 * процессор с бо́льшим числом ядер. Частота — в процентах от базовой, потому что
 * выше ста означает обычный разгон, а ниже под нагрузкой — уже диагноз.
 */
function CpuCard({ cpu }: { cpu: NonNullable<SensorSample['cpu']> }): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className="dot" style={{ background: 'var(--warning)' }} />
        <span className="card-title">Процессор</span>
        <span className="card-note">{cpu.threadCount} потоков</span>
      </div>
      <div className="metrics">
        <Metric
          label="загрузка"
          value={cpu.utilizationPercent === null ? UNKNOWN : `${cpu.utilizationPercent.toFixed(1)} %`}
        />
        <Metric
          label="занято потоков"
          value={cpu.busyThreads === null ? UNKNOWN : `${cpu.busyThreads} из ${cpu.threadCount}`}
        />
        <Metric
          label="частота от базовой"
          value={cpu.performancePercent === null ? UNKNOWN : `${cpu.performancePercent.toFixed(0)} %`}
        />
      </div>
      {/* «93% от базовой» само по себе ничего не говорит. Причина говорит — и
          видна прямо сейчас, а не после разбора записи. */}
      {cpu.throttleReasons.length > 0 && (
        <div className="muted">
          Драйвер сейчас сообщает: {cpu.throttleReasons.join(', ')}.
        </div>
      )}
    </div>
  );
}
