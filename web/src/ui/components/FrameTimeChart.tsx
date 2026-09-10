import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import type { CaptureSeries, EvidenceKind, StutterMark } from '../../domain/models.ts';
import { EVIDENCE_COLOR, EVIDENCE_SHORT } from '../../domain/presentation.ts';
import { ms } from '../../domain/formatting.ts';

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
 *
 * Статтеры разложены по причинам: точка красится в цвет главной улики, а под
 * курсором показываются все улики с числами. До этого график сообщал, что рывок
 * был, но не что случилось, — и отправлял глазами в таблицу ниже, сопоставлять
 * секунды на графике с секундами в списке человек должен был сам.
 */

const FRAME_COLOR = '#4aa8ff';
const GPU_COLOR = '#3fca7a';
const CPU_COLOR = '#ffb340';
const UNEXPLAINED_COLOR = '#8b93a7';

const AXIS_COLOR = '#8b93a7';
const GRID_COLOR = '#262b36';

const CHART_HEIGHT = 260;

/**
 * На сколько пикселей от отметки ещё показываем подсказку.
 *
 * По индексу точки её не поймать: на тысячах точек и девятистах пикселях один
 * пиксель это несколько кадров, и попасть курсором ровно в статтер человек не
 * сможет. Считаем расстояние на экране — оно от числа точек не зависит.
 */
const HOVER_RADIUS_PX = 10;

/** Ключ для статтеров, у которых улик не нашлось. */
const UNEXPLAINED = 'unexplained';

type MarkGroup = EvidenceKind | typeof UNEXPLAINED;

interface Hovered {
  readonly mark: StutterMark;
  readonly left: number;
  readonly top: number;
}

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

  const [hovered, setHovered] = useState<Hovered | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return undefined;

    const groups = groupMarks(series);

    const chart = new uPlot(
      buildOptions(series, groups, element.clientWidth, zoom, setHovered),
      buildData(series, groups),
      element,
    );

    const observer = new ResizeObserver(() => {
      chart.setSize({ width: element.clientWidth, height: CHART_HEIGHT });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.destroy();
      setHovered(null);
    };
  }, [series]);

  return (
    <div className="frame-chart-wrap">
      <div className="frame-chart" ref={container} />
      {hovered !== null && (
        <StutterTip mark={hovered.mark} left={hovered.left} top={hovered.top} />
      )}
    </div>
  );
}

/**
 * Что случилось в этом кадре.
 *
 * Улики показываются все, а не только главная: главная решает лишь цвет точки,
 * а решение человек принимает по числам.
 */
function StutterTip({
  mark,
  left,
  top,
}: {
  mark: StutterMark;
  left: number;
  top: number;
}): React.JSX.Element {
  return (
    <div className="stutter-tip" style={{ left, top }}>
      <div className="stutter-tip-head">
        <span className="dot" style={{ background: colorOf(mark.kind) }} />
        {ms(mark.frameTimeMs)} на {mark.atSeconds.toFixed(1)} с
      </div>
      {mark.evidence.length === 0 ? (
        <div className="muted">Улик не нашлось.</div>
      ) : (
        <ul className="stutter-tip-list">
          {mark.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Статтеры по причинам: каждая причина — своя серия точек своего цвета. */
function groupMarks(series: CaptureSeries): readonly MarkGroup[] {
  const seen = new Set<MarkGroup>();
  for (const mark of series.stutterMarks) {
    seen.add(mark.kind ?? UNEXPLAINED);
  }
  return [...seen];
}

function colorOf(kind: EvidenceKind | null): string {
  return kind === null ? UNEXPLAINED_COLOR : EVIDENCE_COLOR[kind];
}

function labelOf(group: MarkGroup): string {
  return group === UNEXPLAINED ? 'без объяснения' : EVIDENCE_SHORT[group];
}

/**
 * Модель приложения неизменяемая, а uPlot принимает изменяемые массивы —
 * копируем на границе, а не ослабляем типы модели ради библиотеки.
 */
function buildData(series: CaptureSeries, groups: readonly MarkGroup[]): uPlot.AlignedData {
  const data: (number | null)[][] = [[...series.time], [...series.frameTimeMs]];

  for (const group of groups) {
    const points = new Array<number | null>(series.time.length).fill(null);
    for (const mark of series.stutterMarks) {
      if ((mark.kind ?? UNEXPLAINED) === group) points[mark.index] = mark.frameTimeMs;
    }
    data.push(points);
  }

  if (series.gpuBusyMs !== null) data.push([...series.gpuBusyMs]);
  if (series.cpuBusyMs !== null) data.push([...series.cpuBusyMs]);
  return data as uPlot.AlignedData;
}

function buildOptions(
  series: CaptureSeries,
  groups: readonly MarkGroup[],
  width: number,
  zoom: { current: ((from: number, to: number) => void) | undefined },
  onHover: (hovered: Hovered | null) => void,
): uPlot.Options {
  const lines: uPlot.Series[] = [
    { label: 'кадр', stroke: FRAME_COLOR, width: 1, points: { show: false } },
  ];

  // Каждая причина — отдельная серия из одних точек: между ними всюду null,
  // линия не рисуется, а в легенде сама собой появляется расшифровка цветов.
  for (const group of groups) {
    const color = colorOf(group === UNEXPLAINED ? null : group);
    lines.push({
      label: labelOf(group),
      stroke: color,
      width: 0,
      points: { show: true, size: 7, stroke: color, fill: color },
    });
  }

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
      setCursor: [
        (self) => {
          const { left } = self.cursor;
          if (left == null || left < 0) {
            onHover(null);
            return;
          }

          // Ближайшая отметка по экрану, а не по индексу: см. HOVER_RADIUS_PX.
          let closest: Hovered | null = null;
          let best = HOVER_RADIUS_PX;
          for (const mark of series.stutterMarks) {
            const at = self.valToPos(mark.atSeconds, 'x');
            const distance = Math.abs(at - left);
            if (distance > best) continue;
            best = distance;
            closest = { mark, left: at, top: self.valToPos(mark.frameTimeMs, 'y') };
          }
          onHover(closest);
        },
      ],
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
