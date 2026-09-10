import {
  buildProcessTimeline,
  spikeNear,
  type ProcessTimeline,
} from './background-load.ts';
import type { Stutter } from './frame-metrics.ts';
import type { FrameSample } from './frame-sample.ts';
import { GENERIC_SENSOR_SOURCE, type GpuReading, type SensorSample } from './sensor-sample.ts';

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

/**
 * С какой доли записи троттлинг перестаёт объяснять отдельный кадр.
 *
 * Держится он почти всю запись — значит был и в хороших кадрах тоже, и
 * выделять им плохие нечестно. Улику при этом не убираем: троттлинг никуда не
 * делся, просто он про всю запись, а не про этот кадр.
 */
const THROTTLING_IS_BACKGROUND = 0.9;

export type EvidenceKind =
  | 'background-process'
  | 'gpu-work'
  | 'cpu-work'
  | 'waiting'
  | 'present-mode'
  | 'dropped'
  | 'gpu-idle'
  | 'vram-growth'
  | 'throttling';

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  'background-process': 'Рядом работала посторонняя программа',
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
 * Первой идёт посторонняя программа: она единственная называет виновника по
 * имени, а остальные улики называют симптом. «Кадр ждал» говорит, что работу
 * делал кто-то другой, — «в ту же секунду антивирус занял треть процессора»
 * говорит кто именно, и это разница между наблюдением и ответом.
 *
 * Следом «кадр ждал»: её не видно ни в одном счётчике загрузки, и без разбора
 * кадра о ней не узнать вовсе. Дальше то, о чём железо сообщило само. Замыкают
 * обстоятельства вокруг кадра: они сопутствуют, но ничего не объясняют.
 *
 * Полный список улик от этого никуда не девается — он показывается рядом.
 * Порядок решает только, какого цвета точка.
 */
const EVIDENCE_PRIORITY: readonly EvidenceKind[] = [
  'background-process',
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
  /** Имя процесса игры: его собственная работа уже разобрана по кадру. */
  gameProcess = '',
): CorrelationReport {
  const timeline = buildSensorTimeline(sensors);
  const processes = buildProcessTimeline(sensors, gameProcess);
  const correlated = stutters.map((stutter) => ({
    stutter,
    evidence: collectEvidence(frames, stutter, timeline, processes),
  }));

  return {
    stutters: correlated,
    tally: tally(correlated),
    unexplained: correlated.filter((entry) => entry.evidence.length === 0).length,
    limitations: describeLimitations(frames, timeline, processes),
  };
}

// --- улики ------------------------------------------------------------------

function collectEvidence(
  frames: readonly FrameSample[],
  stutter: Stutter,
  timeline: SensorTimeline | null,
  processes: ProcessTimeline | null,
): Evidence[] {
  const frame = frames[stutter.frameIndex];
  if (frame === undefined) return [];

  const evidence: Evidence[] = [];
  evidence.push(...fromFrameBreakdown(frame));
  evidence.push(...fromNeighbours(frames, stutter.frameIndex));
  if (timeline !== null && frame.qpcMs !== null) {
    evidence.push(...fromSensors(timeline, frame.qpcMs));
  }
  if (processes !== null && frame.qpcMs !== null) {
    evidence.push(...fromProcesses(processes, frame.qpcMs));
  }
  return evidence;
}

/**
 * Кто ещё занимал процессор в ту же секунду.
 *
 * Формулировка осторожная намеренно: «рядом работала», а не «из-за неё». Мы
 * видим совпадение по времени с точностью до секунды — вывод о причине из
 * этого не следует, и делать его за человека мы не будем. Зато числа рядом:
 * сколько программа заняла сейчас и сколько занимает обычно за эту же запись.
 */
function fromProcesses(processes: ProcessTimeline, frameQpcMs: number): Evidence[] {
  const spike = spikeNear(processes, frameQpcMs);
  if (spike === null) return [];

  const many = spike.processCount > 1 ? ` (${processCountLabel(spike.processCount)})` : '';
  return [
    {
      kind: 'background-process',
      detail:
        `В ту же секунду ${spike.name}${many} занимал ${spike.cpuPercent.toFixed(0)}% ` +
        `процессора при обычных для него ${spike.usualPercent.toFixed(0)}%.`,
    },
  ];
}

/** «2 процесса», «5 процессов»: строка попадает человеку на глаза как есть. */
function processCountLabel(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} процессов`;
  if (ones >= 2 && ones <= 4) return `${count} процесса`;
  return `${count} процессов`;
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
    const share = Math.round(timeline.throttleTimeShare * 100);
    evidence.push({
      kind: 'throttling',
      detail:
        `Драйвер сообщил: ${[...new Set(throttled)].join(', ')}. ` +
        (timeline.throttleTimeShare >= THROTTLING_IS_BACKGROUND
          ? `Но так было ${share}% записи — это фон, а не примета этого кадра.`
          : `За запись это встретилось в ${share}% замеров.`),
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
  /**
   * Доля замеров, где драйвер вообще сообщал о троттлинге.
   *
   * Нужна, чтобы улика не врала масштабом. Замерено: на холостом ходу бит стоял
   * в двух замерах из двенадцати, под нагрузкой — во всех двадцати шести. Если
   * троттлинг держался всю запись, он совпадёт с каждым рывком, и назвать его
   * приметой конкретного кадра будет подлогом.
   */
  readonly throttleTimeShare: number;
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

  const adapter = mainAdapter(sensors);
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
    throttleTimeShare:
      points.length === 0
        ? 0
        : points.filter((point) => point.throttleReasons.length > 0).length / points.length,
  };
}

/**
 * Какой адаптер считать тем, что рендерит игру.
 *
 * Сначала — умеет ли источник отвечать про троттлинг и температуры. Одна и та
 * же карта приезжает дважды: счётчиками Windows под именем вида `luid_…` и
 * вендорским источником под настоящим именем. Выбор «по загрузке» сравнивал бы
 * эти две записи между собой и мог отдать победу счётчикам — вместе с их
 * незнанием причин.
 *
 * Внутри группы — по наибольшей средней загрузке: на ноутбуке видно и
 * встроенное ядро, и дискретное, а рендерит одно из них.
 */
function mainAdapter(sensors: readonly SensorSample[]): string | null {
  const totals = new Map<string, number>();
  const vendorKnown = new Set<string>();
  for (const sample of sensors) {
    for (const gpu of sample.gpus) {
      totals.set(gpu.adapterName, (totals.get(gpu.adapterName) ?? 0) + utilizationOf(gpu));
      if (gpu.source !== GENERIC_SENSOR_SOURCE) vendorKnown.add(gpu.adapterName);
    }
  }

  const candidates = vendorKnown.size > 0 ? vendorKnown : new Set(totals.keys());

  let best: string | null = null;
  let bestTotal = -1;
  for (const name of candidates) {
    const total = totals.get(name) ?? 0;
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
  processes: ProcessTimeline | null,
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
  if (processes === null) {
    limitations.push(
      'Список занятых процессов не собран — кто ещё занимал процессор, не проверялось.',
    );
  }

  return limitations;
}
