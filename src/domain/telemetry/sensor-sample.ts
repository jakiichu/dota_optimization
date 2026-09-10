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

/**
 * Что процессор делал в момент замера.
 *
 * Загрузка по ядрам отдаётся как есть, но судить по ней об однопоточности
 * нельзя: Windows перекидывает поток между ядрами, и одна занятая нить выглядит
 * как половина на двух. Толкует эти числа `cpu-load.ts`.
 */
export interface CpuReading {
  /** Загрузка всех ядер вместе, 0…100. */
  readonly utilizationPercent: Maybe<number>;
  /**
   * Фактическая частота в процентах от базовой.
   *
   * Выше ста — обычный разгон. Ниже ста под нагрузкой — процессор не держит
   * даже базовую частоту, и это уже диагноз.
   */
  readonly performancePercent: Maybe<number>;
  readonly coreUtilizationPercent: readonly number[];
}

export interface SensorSample {
  readonly capturedAt: string;
  readonly qpcTimestamp: number;
  readonly qpcFrequency: number;
  readonly gpus: readonly GpuReading[];
  /** Процессор в тот же момент. `null` — счётчики недоступны. */
  readonly cpu: Maybe<CpuReading>;
  /** Замеры сети в тот же момент. Пусто — сеть не измерялась. */
  readonly network: readonly NetworkProbe[];
  readonly errors: readonly string[];
}
