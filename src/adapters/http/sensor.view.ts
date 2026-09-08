import type { GpuReading, SensorSample } from '../../domain/telemetry/sensor-sample.ts';

/**
 * Замер в форме, готовой для графика.
 *
 * `elapsedSeconds` считается от первого замера сессии: интерфейсу нужна ось
 * времени, а не абсолютное значение QPC, которое ни с чем не соотносится.
 */
export interface GpuReadingView {
  readonly adapterName: string;
  /** Короткое имя для экрана; полное остаётся в adapterName. */
  readonly displayName: string;
  readonly source: string;
  readonly utilizationPercent: number | null;
  readonly temperatureC: number | null;
  readonly coreClockMhz: number | null;
  readonly powerWatts: number | null;
  readonly memoryUsedMib: number | null;
  readonly memoryTotalMib: number | null;
  readonly throttleReasons: readonly string[];
}

export interface SensorSampleView {
  readonly elapsedSeconds: number;
  readonly gpus: readonly GpuReadingView[];
  readonly errors: readonly string[];
}

const BYTES_IN_MIB = 1024 * 1024;

/**
 * Приводит замеры к общей оси времени.
 *
 * Точка отсчёта берётся из первого увиденного замера и дальше не меняется:
 * значения QPC монотонны, поэтому разность между ними — честные секунды даже
 * при переводе системных часов.
 */
export class SensorViewMapper {
  #originTicks: number | null = null;

  toView(sample: SensorSample): SensorSampleView {
    this.#originTicks ??= sample.qpcTimestamp;

    return {
      elapsedSeconds: this.#elapsedSeconds(sample),
      gpus: sample.gpus.map(toGpuReadingView),
      errors: sample.errors,
    };
  }

  #elapsedSeconds(sample: SensorSample): number {
    if (sample.qpcFrequency === 0 || this.#originTicks === null) return 0;
    return (sample.qpcTimestamp - this.#originTicks) / sample.qpcFrequency;
  }
}

function toGpuReadingView(gpu: GpuReading): GpuReadingView {
  return {
    adapterName: gpu.adapterName,
    displayName: toDisplayName(gpu.adapterName),
    source: gpu.source,
    utilizationPercent: gpu.utilizationPercent,
    temperatureC: gpu.temperatureC,
    coreClockMhz: gpu.coreClockMhz,
    powerWatts: gpu.powerWatts,
    memoryUsedMib: toMib(gpu.memoryUsedBytes),
    memoryTotalMib: toMib(gpu.memoryTotalBytes),
    throttleReasons: gpu.throttleReasons,
  };
}

/**
 * Счётчики Windows называют адаптер только LUID-ом вида
 * `luid_0x00000000_0x0000ED1F_phys_0`. Человеческого имени там нет, поэтому
 * берём значимую часть — по ней хотя бы можно отличить один адаптер от другого.
 */
function toDisplayName(adapterName: string): string {
  const luid = /^luid_0x[0-9a-f]+_0x0*([0-9a-f]+)_phys_(\d+)$/i.exec(adapterName);
  if (luid === null) return adapterName;
  return `Адаптер ${luid[1]?.toUpperCase() ?? '?'} (выход ${luid[2] ?? '?'})`;
}

function toMib(bytes: number | null): number | null {
  return bytes === null ? null : Math.round(bytes / BYTES_IN_MIB);
}
