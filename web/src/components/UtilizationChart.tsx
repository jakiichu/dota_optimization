import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

/**
 * График загрузки во времени.
 *
 * uPlot, а не Chart.js или Recharts: впереди frametime с тысячами точек в
 * секунду, и виртуальный DOM на такой нагрузке умирает. Начинать с библиотеки,
 * которую всё равно придётся выбрасывать, смысла нет.
 */
export interface Series {
  readonly label: string;
  readonly color: string;
  readonly values: readonly number[];
}

export interface UtilizationChartProps {
  readonly time: readonly number[];
  readonly series: readonly Series[];
  readonly maxY: number;
  readonly unit: string;
}

export function UtilizationChart(props: UtilizationChartProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // График создаётся один раз; данные потом подливаются через setData, иначе
  // каждый замер пересоздавал бы canvas.
  useEffect(() => {
    const element = container.current;
    if (element === null) return undefined;

    const chart = new uPlot(
      buildOptions(latest.current, element.clientWidth),
      buildData(latest.current),
      element,
    );
    plot.current = chart;

    const observer = new ResizeObserver(() => {
      chart.setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.series.length, props.maxY, props.unit]);

  useEffect(() => {
    plot.current?.setData(buildData(props));
  }, [props]);

  return <div className="chart" ref={container} />;
}

function buildData(props: UtilizationChartProps): uPlot.AlignedData {
  return [
    props.time as number[],
    ...props.series.map((series) => series.values as number[]),
  ] as uPlot.AlignedData;
}

function buildOptions(props: UtilizationChartProps, width: number): uPlot.Options {
  return {
    width: Math.max(width, 240),
    height: 120,
    padding: [8, 8, 0, 0],
    // Подписи выносим в карточки адаптеров: собственная легенда uPlot
    // растягивает контейнер по самой длинной строке.
    legend: { show: false },
    cursor: { show: true, y: false },
    scales: {
      x: { time: false },
      y: { range: [0, props.maxY] },
    },
    axes: [
      {
        stroke: '#8b93a7',
        grid: { stroke: '#262b36', width: 1 },
        ticks: { stroke: '#262b36' },
        values: (_self, ticks) => ticks.map((tick) => `${Math.round(tick)} с`),
      },
      {
        stroke: '#8b93a7',
        grid: { stroke: '#262b36', width: 1 },
        ticks: { stroke: '#262b36' },
        size: 48,
        values: (_self, ticks) => ticks.map((tick) => `${Math.round(tick)}${props.unit}`),
      },
    ],
    series: [
      {},
      ...props.series.map((series) => ({
        label: series.label,
        stroke: series.color,
        width: 1.5,
        points: { show: false },
      })),
    ],
  };
}
