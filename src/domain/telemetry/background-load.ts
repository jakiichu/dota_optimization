import type { ProcessReading, SensorSample } from './sensor-sample.ts';

/**
 * Кто ещё занимал процессор, пока шла запись.
 *
 * Модуль существует ради одной улики — «кадр ждал». Она значит, что кадр не
 * работал ни на CPU, ни на GPU: работу делал кто-то другой. До сих пор на этом
 * разбор и заканчивался — инструмент называл симптом и умолкал, а человеку
 * оставалось открывать диспетчер задач и смотреть на него после игры, когда
 * виновник уже давно закончил.
 *
 * Отвечаем на два разных вопроса, и путать их нельзя.
 *
 * **Кто занял процессор в ту самую секунду.** Это улика: она про конкретный
 * рывок и сравнивается с тем, что для этой программы обычно. Программа,
 * ровно держащая свои шесть процентов всю запись, ни один рывок не объясняет —
 * она одинакова и в плохих кадрах, и в хороших.
 *
 * **Кто занимал процессор всё время.** Это не улика, а обстановка: постоянная
 * нагрузка не выделяет ни один кадр, но отвечает на вопрос «что вообще
 * крутилось». Такую строку мы показываем отдельно и уликой не называем.
 *
 * **Разрешение этой улики — секунда, а не кадр.** Процессорное время процесса
 * считается по разнице, и на четверти секунды разница вырождается в шум.
 * Поэтому формулировки говорят «в ту же секунду»: сказать «в тот же кадр»
 * значило бы обещать точность, которой нет.
 *
 * **Совпадение — не причина**, и текст обязан это выдерживать: «рядом работал»,
 * а не «из-за него». Мы видим, что программа занимала процессор в ту же
 * секунду; что рывок случился именно из-за неё, отсюда не следует.
 */

/**
 * Ниже этого программу не называют виновником ни при каком превышении.
 *
 * Рост с 0.2% до 2% — это десятикратный всплеск, который не значит ничего.
 */
const SPIKE_FLOOR_PERCENT = 15;

/** Во сколько раз программа должна превысить своё обычное. */
const SPIKE_RATIO = 3;

/**
 * Либо на столько процентных пунктов выше обычного.
 *
 * Кратности одной мало: программе, привычно занимающей четверть процессора,
 * втрое вырасти некуда, а прыжок с 20% до 45% — это три лишних занятых потока
 * и вполне себе событие.
 */
const SPIKE_EXCESS_POINTS = 20;

/** С какой доли процессора программа считается постоянно занятой. */
const STEADY_PERCENT = 5;

/** Сколько постоянно занятых программ показываем. */
const STEADY_SHOWN = 5;

/** Всплеск чужой работы рядом с кадром. */
export interface ProcessSpike {
  readonly name: string;
  /** Доля всего процессора в ту секунду. */
  readonly cpuPercent: number;
  /** Сколько эта же программа занимала обычно за эту запись. */
  readonly usualPercent: number;
  /** Сколько процессов с этим именем сложилось в строку. */
  readonly processCount: number;
}

/** Программа, занимавшая процессор всю запись. */
export interface BackgroundProcess {
  readonly name: string;
  readonly usualPercent: number;
  readonly peakPercent: number;
}

interface ProcessPoint {
  readonly qpcMs: number;
  readonly byName: ReadonlyMap<string, ProcessReading>;
}

export interface ProcessTimeline {
  readonly points: readonly ProcessPoint[];
  /** Сколько каждая программа занимала обычно: медиана по всей записи. */
  readonly usual: ReadonlyMap<string, number>;
}

/**
 * Сводит замеры процессов в одну шкалу.
 *
 * `null` — процессы не читались вовсе. Это не «никто не был занят»: пустая
 * запись и неснятые показания — разные вещи, и обе доходят до отчёта.
 */
export function buildProcessTimeline(
  sensors: readonly SensorSample[],
  /** Процесс игры: его работа уже разобрана по кадру, и второй раз она не улика. */
  gameProcess: string,
): ProcessTimeline | null {
  const game = bareName(gameProcess);
  const points: ProcessPoint[] = [];

  for (const sample of sensors) {
    // `null` — в этот замер процессы не читались, и пропускать его надо молча.
    if (sample.processes === null || sample.qpcFrequency === 0) continue;

    const byName = new Map<string, ProcessReading>();
    for (const process of sample.processes) {
      if (bareName(process.name) === game) continue;
      byName.set(process.name, process);
    }
    points.push({ qpcMs: (sample.qpcTimestamp / sample.qpcFrequency) * 1000, byName });
  }

  if (points.length === 0) return null;

  return { points, usual: usualPercents(points) };
}

/**
 * Что необычного занимало процессор в ту же секунду, что и кадр.
 *
 * `null` — ничего необычного, либо замера, покрывающего этот момент, нет.
 */
export function spikeNear(timeline: ProcessTimeline, frameQpcMs: number): ProcessSpike | null {
  const point = coveringPoint(timeline.points, frameQpcMs);
  if (point === null) return null;

  let worst: ProcessSpike | null = null;
  for (const [name, process] of point.byName) {
    const usual = timeline.usual.get(name) ?? 0;
    if (!isSpike(process.cpuPercent, usual)) continue;
    if (worst !== null && worst.cpuPercent >= process.cpuPercent) continue;

    worst = {
      name,
      cpuPercent: process.cpuPercent,
      usualPercent: usual,
      processCount: process.processCount,
    };
  }
  return worst;
}

/**
 * Кто занимал процессор всю запись.
 *
 * Уликой это не является и в список причин рывков не попадает: постоянная
 * нагрузка одинакова в плохих кадрах и в хороших, а значит ни один из них не
 * выделяет. Но на вопрос «что вообще крутилось» она отвечает, и молчать о
 * шести процентах, съедаемых всю игру, было бы странно.
 */
export function steadyLoad(timeline: ProcessTimeline): readonly BackgroundProcess[] {
  const peaks = new Map<string, number>();
  for (const point of timeline.points) {
    for (const [name, process] of point.byName) {
      peaks.set(name, Math.max(peaks.get(name) ?? 0, process.cpuPercent));
    }
  }

  return [...timeline.usual.entries()]
    .filter(([, usual]) => usual >= STEADY_PERCENT)
    .sort(([, left], [, right]) => right - left)
    .slice(0, STEADY_SHOWN)
    .map(([name, usual]) => ({ name, usualPercent: usual, peakPercent: peaks.get(name) ?? usual }));
}

function isSpike(percent: number, usual: number): boolean {
  if (percent < SPIKE_FLOOR_PERCENT) return false;
  return percent >= usual * SPIKE_RATIO || percent - usual >= SPIKE_EXCESS_POINTS;
}

/**
 * Замер, чей интервал накрывает этот момент.
 *
 * Каждый замер описывает время с предыдущего по свой — значит подходит первый,
 * чья метка не раньше кадра. Ближайший по расстоянию тут не годится: замер,
 * закончившийся за секунду до кадра, описывает совсем другую секунду.
 *
 * Для кадра позже последнего замера ответа нет, и выдумывать его не нужно.
 */
function coveringPoint(points: readonly ProcessPoint[], frameQpcMs: number): ProcessPoint | null {
  for (const point of points) {
    if (point.qpcMs >= frameQpcMs) return point;
  }
  return null;
}

/**
 * Медиана доли процессора по всей записи для каждой программы.
 *
 * Замеры, где программы нет, считаются нулём — и это не натяжка: сайдкар
 * отдаёт всех, кто занял хотя бы процент, значит отсутствие означает «меньше
 * процента». Округление вниз тут безопасно: чтобы всплеск заметили, есть ещё
 * и абсолютный порог.
 */
function usualPercents(points: readonly ProcessPoint[]): ReadonlyMap<string, number> {
  const names = new Set<string>();
  for (const point of points) {
    for (const name of point.byName.keys()) names.add(name);
  }

  const usual = new Map<string, number>();
  for (const name of names) {
    const series = points.map((point) => point.byName.get(name)?.cpuPercent ?? 0);
    usual.set(name, median(series));
  }
  return usual;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** `dota2.exe` и `dota2` — одно и то же: у .NET имя процесса без расширения. */
function bareName(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/u, '');
}
