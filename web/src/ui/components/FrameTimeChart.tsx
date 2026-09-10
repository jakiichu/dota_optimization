import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import type { CaptureSeries } from '../../domain/models.ts';

/**
 * График времени кадра за записанную сессию.
 *
 * Кадры не усредняются — никогда. Усреднение убирает ровно то, ради чего запись
 * и делалась: одиночный кадр на 200 мс исчезает в соседях. Когда кадров сотни
 * тысяч, сервер выбирает из каждого окна настоящие самый короткий и самый
 * длинный, поэтому пик остаётся на месте и остаётся собой.
 *
 * Выделение мышью просит у сервера этот участок целиком: увеличение должно
 * показывать кадры, а не ту же огибающую крупнее.
 */
const STUTTER_COLOR = '#ff5f56';
const FRAME_COLOR = '#4aa8ff';
const GPU_COLOR = '#3fca7a';
const CPU_COLOR = '#ffb340';

const AXIS_COLOR = '#8b93a7';
const GRID_COLOR = '#262b36';

const CHART_HEIGHT = 260;

export function FrameTimeChart({
  series,
  onZoom,
}: {
  series: CaptureSeries;
  /** Человек выделил участок: показать его кадр за кадром. */
  onZoom?: (fromSeconds: number, toSeconds: number) => void;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  // Через ref, чтобы смена обработчика не пересоздавала график целиком.
  const zoom = useRef(onZoom);
  zoom.current = onZoom;

  useEffect(() => {
    const element = container.current;
    if (element === null) return undefined;

    const chart = new uPlot(
      buildOptions(series, element.clientWidth, zoom),
      buildData(series),
      element,
    );

    const observer = new ResizeObserver(() => {
      chart.setSize({ width: element.clientWidth, height: CHART_HEIGHT });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.destroy();
    };
  }, [series]);

  return <div className="frame-chart" ref={container} />;
}

/**
 * Модель приложения неизменяемая, а uPlot принимает изменяемые массивы —
 * копируем на границе, а не ослабляем типы модели ради библиотеки.
 */
function buildData(series: CaptureSeries): uPlot.AlignedData {
  const data: (number | null)[][] = [
    [...series.time],
    [...series.frameTimeMs],
    [...series.stutterMs],
  ];
  if (series.gpuBusyMs !== null) data.push([...series.gpuBusyMs]);
  if (series.cpuBusyMs !== null) data.push([...series.cpuBusyMs]);
  return data as uPlot.AlignedData;
}

function buildOptions(
  series: CaptureSeries,
  width: number,
  zoom: { current: ((from: number, to: number) => void) | undefined },
): uPlot.Options {
  const lines: uPlot.Series[] = [
    {
      label: 'кадр',
      stroke: FRAME_COLOR,
      width: 1,
      points: { show: false },
    },
    // Статтеры — отдельная серия из одних точек: между ними всюду null, и линия
    // не рисуется, только отметки поверх основной.
    {
      label: 'статтер',
      stroke: STUTTER_COLOR,
      width: 0,
      points: { show: true, size: 6, stroke: STUTTER_COLOR, fill: STUTTER_COLOR },
    },
  ];

  if (series.gpuBusyMs !== null) {
    lines.push({ label: 'GPU', stroke: GPU_COLOR, width: 1, points: { show: false } });
  }
  if (series.cpuBusyMs !== null) {
    lines.push({ label: 'CPU', stroke: CPU_COLOR, width: 1, points: { show: false } });
  }

  return {
    width: Math.max(width, 320),
    height: CHART_HEIGHT,
    padding: [12, 12, 0, 0],
    legend: { show: true },
    cursor: { y: false },
    scales: { x: { time: false } },
    hooks: {
      // uPlot меняет диапазон и после сброса двойным щелчком; отличаем выделение
      // по тому, что новый диапазон уже показанного.
      setScale: [
        (self, key) => {
          if (key !== 'x' || zoom.current === undefined) return;
          const scale = self.scales['x'];
          const min = scale?.min;
          const max = scale?.max;
          if (min === undefined || max === undefined) return;

          const shownFrom = series.time[0] ?? 0;
          const shownTo = series.time.at(-1) ?? 0;
          if (min <= shownFrom && max >= shownTo) return;

          zoom.current(min, max);
        },
      ],
    },
    axes: [
      {
        stroke: AXIS_COLOR,
        grid: { stroke: GRID_COLOR, width: 1 },
        ticks: { stroke: GRID_COLOR },
        values: (_self, ticks) => ticks.map((tick) => `${tick.toFixed(0)} с`),
      },
      {
        stroke: AXIS_COLOR,
        grid: { stroke: GRID_COLOR, width: 1 },
        ticks: { stroke: GRID_COLOR },
        size: 56,
        values: (_self, ticks) => ticks.map((tick) => `${tick.toFixed(0)} мс`),
      },
    ],
    series: [{}, ...lines],
  };
}
