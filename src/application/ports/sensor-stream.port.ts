import type { SensorSample } from '../../domain/telemetry/sensor-sample.ts';

export type SampleListener = (sample: SensorSample) => void;
export type Unsubscribe = () => void;

/**
 * Непрерывный поток замеров.
 *
 * Отдельный порт, а не `SensorSampler` в цикле: разовый замер стоит запуска
 * процесса, и опрашивать им четыре раза в секунду нельзя. Источник должен сам
 * решать, как держать поток дешёвым.
 */
export interface SensorStream {
  /**
   * Подписаться на замеры. Источник запускается на первом подписчике и
   * останавливается, когда уходит последний.
   */
  subscribe(listener: SampleListener): Unsubscribe;
}
