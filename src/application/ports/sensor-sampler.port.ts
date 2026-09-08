import type { SensorSample } from '../../domain/telemetry/sensor-sample.ts';

/**
 * Источник мгновенных показаний по видеоадаптерам.
 *
 * За портом прячется вопрос «какой вендорский API доступен на этой машине»:
 * NVML есть только с драйвером NVIDIA, счётчики производительности — везде.
 * Сценарию это знать не нужно.
 */
export interface SensorSampler {
  sample(): Promise<SensorSample>;
}
