import type { Bottleneck } from './frame-metrics.ts';
import type { SensorSample } from './sensor-sample.ts';

/**
 * Что происходило с процессором за запись.
 *
 * «Упор в процессор» — вердикт правильный, но бесполезный: непонятно, что с ним
 * делать. Здесь он раскладывается на два разных ответа, и действия по ним
 * противоположные.
 *
 * **Занято мало потоков.** Игра упирается в скорость одного ядра, а не в их
 * число. Больше ядер не поможет; помогут частоты, память и снятие работы с
 * главного потока.
 *
 * **Процессор сбрасывает частоты.** Он не держит даже базовую — настройками
 * графики это не лечится вовсе. На ноутбуке случается куда чаще, чем думают.
 *
 * По загрузке отдельных ядер судить об однопоточности нельзя, и мы этого не
 * делаем: Windows перекидывает поток между ядрами, и одна занятая нить выглядит
 * как половина на двух. Считаем иначе — сколько потоков занято суммарно.
 */

export interface CpuLoadProfile {
  /** Были ли показания вообще. */
  readonly measured: boolean;
  /** Медианная загрузка всех ядер, проценты. */
  readonly utilizationPercent: number | null;
  /** Сколько логических ядер видно. */
  readonly threadCount: number | null;
  /**
   * Сколько потоков занято целиком.
   *
   * Загрузка в процентах умноженная на число ядер: «4.1 из 16» понятнее, чем
   * «25.7%», и сразу отвечает на вопрос, поможет ли процессор с бо́льшим числом
   * ядер.
   */
  readonly busyThreads: number | null;
  /** Медианная частота в процентах от базовой. */
  readonly performancePercent: number | null;
  /** Самая низкая частота за запись — по ней и видно провалы. */
  readonly lowestPerformancePercent: number | null;
  /** Процессор не держал базовую частоту. */
  readonly throttled: boolean;
  /** Упор в скорость одного ядра, а не в их число. */
  readonly singleThreadBound: boolean;
  readonly summary: string;
}

/**
 * Ниже этой доли базовой частоты считаем, что процессор её не держит.
 *
 * Не сто процентов: короткие провалы при переключении состояний питания —
 * норма, и объявлять троттлингом каждый из них значило бы кричать постоянно.
 */
const HOLDS_BASE_CLOCK = 90;

/**
 * Больше скольких занятых потоков нагрузка уже не считается однопоточной.
 *
 * Три, а не один: кроме главного потока Dota держит поток отрисовки и звук, и
 * при настоящем упоре в одно ядро занятых выходит два-три, а не ровно один.
 */
const FEW_BUSY_THREADS = 3;

const NOT_MEASURED: CpuLoadProfile = {
  measured: false,
  utilizationPercent: null,
  threadCount: null,
  busyThreads: null,
  performancePercent: null,
  lowestPerformancePercent: null,
  throttled: false,
  singleThreadBound: false,
  summary: 'Показаний по процессору не было.',
};

export function analyzeCpuLoad(
  samples: readonly SensorSample[],
  bottleneck: Bottleneck,
): CpuLoadProfile {
  const readings = samples
    .map((sample) => sample.cpu)
    .filter((cpu): cpu is NonNullable<SensorSample['cpu']> => cpu != null);
  if (readings.length === 0) return NOT_MEASURED;

  const utilization = median(
    readings.map((cpu) => cpu.utilizationPercent).filter(isNumber),
  );
  const performance = median(
    readings.map((cpu) => cpu.performancePercent).filter(isNumber),
  );
  const performances = readings.map((cpu) => cpu.performancePercent).filter(isNumber);
  const lowest = performances.length === 0 ? null : Math.min(...performances);

  const threadCount =
    Math.max(...readings.map((cpu) => cpu.coreUtilizationPercent.length), 0) || null;
  const busyThreads =
    utilization === null || threadCount === null
      ? null
      : Math.round(((utilization * threadCount) / 100) * 10) / 10;

  const throttled = performance !== null && performance < HOLDS_BASE_CLOCK;
  const singleThreadBound =
    bottleneck.kind === 'cpu' && busyThreads !== null && busyThreads <= FEW_BUSY_THREADS;

  return {
    measured: true,
    utilizationPercent: utilization,
    threadCount,
    busyThreads,
    performancePercent: performance,
    lowestPerformancePercent: lowest,
    throttled,
    singleThreadBound,
    summary: describe({ utilization, threadCount, busyThreads, performance, throttled, singleThreadBound }),
  };
}

interface Described {
  readonly utilization: number | null;
  readonly threadCount: number | null;
  readonly busyThreads: number | null;
  readonly performance: number | null;
  readonly throttled: boolean;
  readonly singleThreadBound: boolean;
}

function describe(found: Described): string {
  const parts: string[] = [];

  if (found.busyThreads !== null && found.threadCount !== null) {
    parts.push(`Занято ${found.busyThreads} потока из ${found.threadCount}.`);
  }

  if (found.singleThreadBound) {
    parts.push(
      'Кадр ограничен скоростью одного ядра, а не их числом: процессор с бо́льшим ' +
        'числом ядер этого не изменит.',
    );
  }

  if (found.throttled && found.performance !== null) {
    parts.push(
      `Частота держалась на ${found.performance.toFixed(0)}% от базовой — процессор ` +
        'её не тянул.',
    );
  } else if (found.performance !== null) {
    parts.push(`Частота — ${found.performance.toFixed(0)}% от базовой.`);
  }

  return parts.length === 0 ? 'Показания по процессору неполные.' : parts.join(' ');
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}
