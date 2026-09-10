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
  /**
   * Почему процессор сбрасывает частоты, по словам драйвера.
   *
   * Счётчики Windows показывают, что частота ниже базовой, но не говорят
   * отчего. У AMD причина приезжает через ADL тем же вызовом, что и состояние
   * видеоядра: у APU питание общее. Пусто — причин не было или источника нет.
   */
  readonly throttleReasons: readonly string[];
}

/**
 * Сколько процессора заняла одна программа за интервал замера.
 *
 * Именно программа, а не процесс: браузер с дюжиной вкладок — это дюжина
 * процессов по три процента, и назвать виновником один из них неверно.
 * Складывает их по имени сайдкар, до нас доходит уже сумма.
 */
export interface ProcessReading {
  readonly name: string;
  /** Доля всего процессора, 0…100. */
  readonly cpuPercent: number;
  /** Сколько процессов с этим именем сложилось в строку. */
  readonly processCount: number;
}

/**
 * Источник, который есть на любой машине, но знает мало.
 *
 * Счётчики Windows дают загрузку и занятую видеопамять — и всё: ни температур,
 * ни частот, ни причин троттлинга. По наличию любого другого источника в замере
 * видно, спрашивали ли вообще про эти величины, а значит — можно отличить
 * «причин не было» от «некому было ответить».
 */
export const GENERIC_SENSOR_SOURCE = 'pdh';

export interface SensorSample {
  readonly capturedAt: string;
  readonly qpcTimestamp: number;
  readonly qpcFrequency: number;
  readonly gpus: readonly GpuReading[];
  /** Процессор в тот же момент. `null` — счётчики недоступны. */
  readonly cpu: Maybe<CpuReading>;
  /** Замеры сети в тот же момент. Пусто — сеть не измерялась. */
  readonly network: readonly NetworkProbe[];
  /**
   * Кто ещё занимал процессор.
   *
   * `null` — в этот замер процессы не читались: у них своё разрешение, около
   * секунды, и совпадать с шагом остальных счётчиков они не обязаны. Пустой
   * список — читали, и никто не был занят. Разные вещи.
   */
  readonly processes: Maybe<readonly ProcessReading[]>;
  readonly errors: readonly string[];
}
