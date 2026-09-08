import type { GpuReading, SensorSample } from '../../domain/telemetry/sensor-sample.ts';
import type { SensorSampler } from '../ports/sensor-sampler.port.ts';

/**
 * Снять текущие показания по адаптерам.
 *
 * Порядок задаётся здесь, а не в презентере: «сначала тот, кто занят» — это
 * правило чтения данных, а не оформление.
 */
export class ReadSensors {
  readonly #sampler: SensorSampler;

  constructor(sampler: SensorSampler) {
    this.#sampler = sampler;
  }

  async execute(): Promise<SensorSample> {
    const sample = await this.#sampler.sample();
    return { ...sample, gpus: [...sample.gpus].sort(byBusiestFirst) };
  }
}

function byBusiestFirst(left: GpuReading, right: GpuReading): number {
  return (right.utilizationPercent ?? -1) - (left.utilizationPercent ?? -1);
}
