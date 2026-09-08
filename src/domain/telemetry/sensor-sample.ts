import type { GpuVendor, Maybe } from '../snapshot/system-snapshot.ts';

/**
 * Показания одного видеоадаптера в момент времени.
 *
 * Соглашение о `null` то же, что в снимке конфигурации: `null` — «не прочитали»,
 * а не «ноль». Источник данных у каждого поля разный, и температура, недоступная
 * без вендорского API, не должна выглядеть как холодная карта.
 */
export interface GpuReading {
  readonly adapterName: string;
  readonly vendor: GpuVendor;
  /** Откуда взяты показания: nvml, pdh. */
  readonly source: string;
  readonly temperatureC: Maybe<number>;
  readonly coreClockMhz: Maybe<number>;
  readonly memoryClockMhz: Maybe<number>;
  readonly powerWatts: Maybe<number>;
  readonly powerLimitWatts: Maybe<number>;
  readonly memoryUsedBytes: Maybe<number>;
  readonly memoryTotalBytes: Maybe<number>;
  readonly utilizationPercent: Maybe<number>;
  /** Почему карта не идёт на полных частотах. Пусто — причин нет или их не видно. */
  readonly throttleReasons: readonly string[];
}

/**
 * Один замер по всем адаптерам.
 *
 * `qpcTimestamp` — монотонные часы Windows. Только по ним замер можно положить
 * на одну ось с кадрами PresentMon: настенное время для этого не годится, оно
 * прыгает при синхронизации.
 */
/**
 * Замер задержки до узла сети.
 *
 * `roundTripMs` равен `null`, когда ответа не было: потерянный пакет — не
 * нулевая задержка.
 */
export interface NetworkProbe {
  readonly target: string;
  /** Человеческое имя: «шлюз Wi-Fi», «интернет». */
  readonly label: string;
  readonly roundTripMs: Maybe<number>;
  readonly success: boolean;
  readonly status: Maybe<string>;
}

export interface SensorSample {
  readonly capturedAt: string;
  readonly qpcTimestamp: number;
  readonly qpcFrequency: number;
  readonly gpus: readonly GpuReading[];
  /** Замеры сети в тот же момент. Пусто — сеть не измерялась. */
  readonly network: readonly NetworkProbe[];
  readonly errors: readonly string[];
}
