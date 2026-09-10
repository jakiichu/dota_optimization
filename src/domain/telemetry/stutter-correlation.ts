import type { Stutter } from './frame-metrics.ts';
import type { FrameSample } from './frame-sample.ts';
import type { GpuReading, SensorSample } from './sensor-sample.ts';

/**
 * Что происходило рядом с каждым статтером.
 *
 * Правила здесь намеренно простые и объяснимые. Диагностический инструмент
 * должен уметь показать, из каких чисел сделан вывод, — иначе его нельзя ни
 * проверить, ни оспорить. Поэтому никакой модели, только пороги, и каждая
 * улика несёт цифры, по которым её можно перепроверить руками.
 */

/** Окно перед кадром, в котором ищем причину. */
const WINDOW_MS = 200;

/** Доля кадра, занятая устройством, начиная с которой считаем его виновником. */
const WORK_SHARE = 0.8;

/** Ниже этой суммарной доли кадр не работал, а ждал. */
const IDLE_SHARE = 0.5;

/** Насколько должна просесть загрузка GPU относительно обычной для записи. */
const GPU_IDLE_RATIO = 0.5;

/** Прирост видеопамяти в окне, начиная с которого это уже похоже на загрузку ресурсов. */
const VRAM_GROWTH_MIB = 64;

/** Сколько кадров вокруг смотрим на смену режима вывода и отброшенные кадры. */
const NEIGHBOUR_FRAMES = 5;

export type EvidenceKind =
  | 'gpu-work'
  | 'cpu-work'
  | 'waiting'
  | 'present-mode'
  | 'dropped'
  | 'gpu-idle'
  | 'vram-growth'
  | 'throttling';

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  'gpu-work': 'Кадр целиком занят работой GPU',
  'cpu-work': 'Кадр целиком занят работой CPU',
  waiting: 'Кадр ждал, а не работал',
  'present-mode': 'Сменился режим вывода',
  dropped: 'Рядом отброшены кадры',
  'gpu-idle': 'Загрузка GPU провалилась перед кадром',
  'vram-growth': 'В окне росла видеопамять',
  throttling: 'Видеокарта сообщила о троттлинге',
};

export interface Evidence {
  readonly kind: EvidenceKind;
  /** Цифры, по которым вывод можно перепроверить. */
  readonly detail: string;
}

export interface CorrelatedStutter {
  readonly stutter: Stutter;
  readonly evidence: readonly Evidence[];
}

/**
 * Порядок улик по объяснительной силе.
 *
 * Нужен там, где на статтер приходится одна пометка, а улик у него несколько:
 * на графике точку можно покрасить только в один цвет.
 *
 * Первым идёт «кадр ждал» — самая неприятная и самая полезная улика: её не
 * видно ни в одном счётчике загрузки, и без разбора кадра о ней не узнать
 * вовсе. Дальше то, о чём железо сообщило само. Замыкают обстоятельства вокруг
 * кадра: они сопутствуют, но ничего не объясняют.
 *
 * Полный список улик от этого никуда не девается — он показывается рядом.
 * Порядок решает только, какого цвета точка.
 */
const EVIDENCE_PRIORITY: readonly EvidenceKind[] = [
  'waiting',
  'throttling',
  'present-mode',
  'cpu-work',
  'gpu-work',
  'gpu-idle',
  'vram-growth',
  'dropped',
];

/** Улика, по которой стоит называть причину. `null` — улик не нашлось. */
export function primaryEvidence(evidence: readonly Evidence[]): EvidenceKind | null {
  for (const kind of EVIDENCE_PRIORITY) {
    if (evidence.some((item) => item.kind === kind)) return kind;
  }
  return null;
}

export interface CauseTally {
  readonly kind: EvidenceKind;
  readonly label: string;
  readonly count: number;
}

export interface CorrelationReport {
  readonly stutters: readonly CorrelatedStutter[];
  /** Сколько статтеров совпало с каждой причиной, по убыванию. */
  readonly tally: readonly CauseTally[];
  /** Статтеры, к которым не нашлось ни одной улики. */
  readonly unexplained: number;
  /** Чего не хватило для полного разбора. */
  readonly limitations: readonly string[];
}

export function correlateStutters(
  frames: readonly FrameSample[],
  stutters: readonly Stutter[],
  sensors: readonly SensorSample[],
): CorrelationReport {
  const timeline = buildSensorTimeline(sensors);
  const correlated = stutters.map((stutter) => ({
    stutter,
    evidence: collectEvidence(frames, stutter, timeline),
  }));

  return {
    stutters: correlated,
    tally: tally(correlated),
    unexplained: correlated.filter((entry) => entry.evidence.length === 0).length,
    limitations: describeLimitations(frames, timeline),
  };
}

// --- улики ------------------------------------------------------------------

function collectEvidence(
  frames: readonly FrameSample[],
  stutter: Stutter,
  timeline: SensorTimeline | null,
): Evidence[] {
  const frame = frames[stutter.frameIndex];
  if (frame === undefined) return [];

  const evidence: Evidence[] = [];
  evidence.push(...fromFrameBreakdown(frame));
  evidence.push(...fromNeighbours(frames, stutter.frameIndex));
  if (timeline !== null && frame.qpcMs !== null) {
    evidence.push(...fromSensors(timeline, frame.qpcMs));
  }
  return evidence;
}

/**
 * Разбивка самого кадра.
 *
 * Самая надёжная улика: она про тот же кадр, а не про то, что было рядом.
 */
function fromFrameBreakdown(frame: FrameSample): Evidence[] {
  const { cpuBusyMs, gpuBusyMs, frameTimeMs } = frame;
  if (frameTimeMs === 0) return [];

  const evidence: Evidence[] = [];

  if (gpuBusyMs !== null && gpuBusyMs / frameTimeMs >= WORK_SHARE) {
    evidence.push({
      kind: 'gpu-work',
      detail: `GPU работал ${gpuBusyMs.toFixed(1)} мс из ${frameTimeMs.toFixed(1)} мс кадра.`,
    });
  }

  if (cpuBusyMs !== null && cpuBusyMs / frameTimeMs >= WORK_SHARE) {
    evidence.push({
      kind: 'cpu-work',
      detail: `CPU работал ${cpuBusyMs.toFixed(1)} мс из ${frameTimeMs.toFixed(1)} мс кадра.`,
    });
  }

  // Ни то, ни другое: кадр простоял в очереди презентов, у планировщика или у
  // драйвера. Отдельная и самая неприятная категория — её не видно ни в одном
  // счётчике загрузки.
  if (cpuBusyMs !== null && gpuBusyMs !== null) {
    const busy = (cpuBusyMs + gpuBusyMs) / frameTimeMs;
    if (busy < IDLE_SHARE) {
      evidence.push({
        kind: 'waiting',
        detail:
          `Из ${frameTimeMs.toFixed(1)} мс кадра CPU занял ${cpuBusyMs.toFixed(1)} мс, ` +
          `GPU ${gpuBusyMs.toFixed(1)} мс — остальное кадр ждал.`,
      });
    }
  }

  return evidence;
}

function fromNeighbours(frames: readonly FrameSample[], index: number): Evidence[] {
  const from = Math.max(0, index - NEIGHBOUR_FRAMES);
  const to = Math.min(frames.length, index + NEIGHBOUR_FRAMES + 1);
  const window = frames.slice(from, to);

  const evidence: Evidence[] = [];

  const modes = new Set(
    window
      .map((frame) => frame.presentMode)
      .filter((mode): mode is string => mode !== null),
  );
  if (modes.size > 1) {
    evidence.push({
      kind: 'present-mode',
      detail: `Рядом сменился режим вывода: ${[...modes].join(' → ')}.`,
    });
  }

  const dropped = window.filter((frame) => frame.dropped === true).length;
  if (dropped > 0) {
    evidence.push({
      kind: 'dropped',
      detail: `Рядом ${dropped} отброшенных кадров — они не дошли до экрана.`,
    });
  }

  return evidence;
}

function fromSensors(timeline: SensorTimeline, frameQpcMs: number): Evidence[] {
  const window = timeline.points.filter(
    (point) => point.qpcMs >= frameQpcMs - WINDOW_MS && point.qpcMs <= frameQpcMs,
  );
  if (window.length === 0) return [];

  const evidence: Evidence[] = [];

  const utilizations = window
    .map((point) => point.utilizationPercent)
    .filter((value): value is number => value !== null);
  if (
    utilizations.length > 0 &&
    timeline.medianUtilization !== null &&
    timeline.medianUtilization > 0
  ) {
    const lowest = Math.min(...utilizations);
    if (lowest < timeline.medianUtilization * GPU_IDLE_RATIO) {
      evidence.push({
        kind: 'gpu-idle',
        detail:
          `За ${WINDOW_MS} мс до кадра загрузка GPU падала до ${lowest.toFixed(0)}% ` +
          `при обычных ${timeline.medianUtilization.toFixed(0)}% — GPU простаивал, ` +
          'значит ждал не он.',
      });
    }
  }

  const memory = window
    .map((point) => point.memoryUsedMib)
    .filter((value): value is number => value !== null);
  if (memory.length > 1) {
    const growth = Math.max(...memory) - Math.min(...memory);
    if (growth >= VRAM_GROWTH_MIB) {
      evidence.push({
        kind: 'vram-growth',
        detail: `За ${WINDOW_MS} мс до кадра видеопамять выросла на ${growth} МиБ.`,
      });
    }
  }

  const throttled = window.flatMap((point) => point.throttleReasons);
  if (throttled.length > 0) {
    evidence.push({
      kind: 'throttling',
      detail: `Драйвер сообщил: ${[...new Set(throttled)].join(', ')}.`,
    });
  }

  return evidence;
}

// --- сведение сенсоров в одну шкалу -----------------------------------------

interface SensorPoint {
  readonly qpcMs: number;
  readonly utilizationPercent: number | null;
  readonly memoryUsedMib: number | null;
  readonly throttleReasons: readonly string[];
}

interface SensorTimeline {
  readonly points: readonly SensorPoint[];
  readonly medianUtilization: number | null;
  readonly adapterName: string;
}

const BYTES_IN_MIB = 1024 * 1024;

/**
 * Сводит замеры к одной шкале и одному адаптеру.
 *
 * Адаптер выбирается по наибольшей средней загрузке: на ноутбуке счётчики видят
 * и встроенное ядро, и дискретное, а рендерит игру одно из них.
 */
function buildSensorTimeline(sensors: readonly SensorSample[]): SensorTimeline | null {
  if (sensors.length === 0) return null;

  const adapter = busiestAdapter(sensors);
  if (adapter === null) return null;

  const points: SensorPoint[] = [];
  for (const sample of sensors) {
    if (sample.qpcFrequency === 0) continue;
    const reading = sample.gpus.find((gpu) => gpu.adapterName === adapter);
    if (reading === undefined) continue;

    points.push({
      qpcMs: (sample.qpcTimestamp / sample.qpcFrequency) * 1000,
      utilizationPercent: reading.utilizationPercent,
      memoryUsedMib:
        reading.memoryUsedBytes === null
          ? null
          : Math.round(reading.memoryUsedBytes / BYTES_IN_MIB),
      throttleReasons: reading.throttleReasons,
    });
  }

  return {
    points,
    medianUtilization: median(
      points
        .map((point) => point.utilizationPercent)
        .filter((value): value is number => value !== null),
    ),
    adapterName: adapter,
  };
}

function busiestAdapter(sensors: readonly SensorSample[]): string | null {
  const totals = new Map<string, number>();
  for (const sample of sensors) {
    for (const gpu of sample.gpus) {
      totals.set(gpu.adapterName, (totals.get(gpu.adapterName) ?? 0) + utilizationOf(gpu));
    }
  }

  let best: string | null = null;
  let bestTotal = -1;
  for (const [name, total] of totals) {
    if (total > bestTotal) {
      best = name;
      bestTotal = total;
    }
  }
  return best;
}

function utilizationOf(gpu: GpuReading): number {
  return gpu.utilizationPercent ?? 0;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

// --- сводка -----------------------------------------------------------------

function tally(correlated: readonly CorrelatedStutter[]): CauseTally[] {
  const counts = new Map<EvidenceKind, number>();
  for (const entry of correlated) {
    for (const kind of new Set(entry.evidence.map((item) => item.kind))) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: EVIDENCE_LABEL[kind], count }))
    .sort((left, right) => right.count - left.count);
}

/**
 * Честно перечисляет, чего не хватило.
 *
 * Пустой список причин из-за отсутствующих данных и пустой из-за того, что
 * причин не нашлось, — разные вещи, и путать их нельзя.
 */
function describeLimitations(
  frames: readonly FrameSample[],
  timeline: SensorTimeline | null,
): string[] {
  const limitations: string[] = [];
  const first = frames[0];

  if (first !== undefined && first.cpuBusyMs === null) {
    limitations.push(
      'В записи нет разбивки кадра по CPU и GPU — нужны метрики PresentMon 2.x.',
    );
  }
  if (first !== undefined && first.qpcMs === null) {
    limitations.push(
      'У кадров нет абсолютного времени — сопоставить их с сенсорами нельзя.',
    );
  }
  if (timeline === null) {
    limitations.push('Показания сенсоров за время записи не собраны.');
  } else if (timeline.medianUtilization === null) {
    limitations.push('Загрузка GPU не читалась — провалы загрузки не проверялись.');
  }

  return limitations;
}
