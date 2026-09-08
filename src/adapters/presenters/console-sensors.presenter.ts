import type { GpuReading, SensorSample } from '../../domain/telemetry/sensor-sample.ts';

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

const BYTES_IN_MIB = 1024 * 1024;
const UNKNOWN = '—';

export interface ConsoleSensorsOptions {
  readonly color: boolean;
}

/**
 * Показывает замер так, чтобы сразу было видно, чего мы не знаем.
 *
 * Прочерк вместо нуля — не косметика: увидев «0 °C», человек решит, что датчик
 * сломан, а увидев прочерк — что температуру мы просто не читаем.
 */
export function renderSensorSample(
  sample: SensorSample,
  options: ConsoleSensorsOptions,
): string {
  const paint = (text: string, code: string): string =>
    options.color ? `${code}${text}${RESET}` : text;

  const lines: string[] = [];
  lines.push(paint('Показания видеоадаптеров', BOLD));
  lines.push(paint(`${sample.capturedAt} · QPC ${sample.qpcTimestamp}`, DIM));
  lines.push('');

  if (sample.gpus.length === 0) {
    lines.push('Ни один источник не вернул данных.');
  }

  for (const gpu of sample.gpus) {
    lines.push(...renderGpu(gpu, paint));
    lines.push('');
  }

  if (sample.errors.length > 0) {
    lines.push(paint('Недоступные источники:', DIM));
    for (const error of sample.errors) {
      lines.push(paint(`  · ${error}`, DIM));
    }
  }

  return lines.join('\n').trimEnd();
}

function renderGpu(
  gpu: GpuReading,
  paint: (text: string, code: string) => string,
): string[] {
  const lines: string[] = [];
  lines.push(`${paint(gpu.adapterName, BOLD)} ${paint(`(${gpu.source})`, DIM)}`);
  lines.push(`  загрузка:    ${percent(gpu.utilizationPercent)}`);
  lines.push(`  температура: ${withUnit(gpu.temperatureC, ' °C')}`);
  lines.push(`  частоты:     ${withUnit(gpu.coreClockMhz, ' МГц')} / ${withUnit(gpu.memoryClockMhz, ' МГц')} (ядро / память)`);
  lines.push(`  питание:     ${watts(gpu.powerWatts)} из ${watts(gpu.powerLimitWatts)}`);
  lines.push(`  видеопамять: ${mebibytes(gpu.memoryUsedBytes)} из ${mebibytes(gpu.memoryTotalBytes)}`);

  if (gpu.throttleReasons.length > 0) {
    lines.push(`  троттлинг:   ${gpu.throttleReasons.join(', ')}`);
  }
  return lines;
}

function percent(value: number | null): string {
  return value === null ? UNKNOWN : `${value.toFixed(1)} %`;
}

function withUnit(value: number | null, unit: string): string {
  return value === null ? UNKNOWN : `${value}${unit}`;
}

function watts(value: number | null): string {
  return value === null ? UNKNOWN : `${value.toFixed(1)} Вт`;
}

function mebibytes(value: number | null): string {
  return value === null ? UNKNOWN : `${Math.round(value / BYTES_IN_MIB)} МиБ`;
}
