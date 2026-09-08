import type { Maybe } from '../snapshot/system-snapshot.ts';

/**
 * Один кадр.
 *
 * `frameTimeMs` — время между презентами, то есть та величина, которую человек
 * ощущает как плавность. Средний FPS из неё выводится, но обратно не
 * восстанавливается: сто кадров по 10 мс и девяносто по 5 мс плюс десять по
 * 55 мс дают одинаковые 100 FPS и совершенно разные ощущения.
 */
export interface FrameSample {
  /** Секунды от начала записи — ось для графика. */
  readonly startSeconds: number;
  /**
   * Абсолютное время по счётчику производительности, мс.
   *
   * Единственное, что позволяет положить кадры и показания сенсоров на одну
   * ось: настенное время для этого не годится, оно прыгает при синхронизации.
   * `null` — если PresentMon запускали без `--qpc_time_ms`.
   */
  readonly qpcMs: Maybe<number>;
  readonly frameTimeMs: number;
  /** Сколько кадр занял CPU. Недоступно в метриках PresentMon 1.x. */
  readonly cpuBusyMs: Maybe<number>;
  /** Сколько кадр занял GPU. Недоступно в метриках PresentMon 1.x. */
  readonly gpuBusyMs: Maybe<number>;
  /** Задержка от готовности кадра до появления на экране. */
  readonly displayLatencyMs: Maybe<number>;
  readonly presentMode: Maybe<string>;
  /**
   * Интервал синхронизации: 0 — вертикальная синхронизация выключена.
   *
   * Нужен, чтобы отличить промах мимо развёртки от честной просадки: при
   * выключенной синхронизации удвоенных кадров быть не должно вовсе.
   */
  readonly syncInterval: Maybe<number>;
  readonly allowsTearing: Maybe<boolean>;
  /**
   * От нажатия до появления на экране, мс.
   *
   * Меряется только для кадров, на которые пришёлся ввод, — у остальных `null`.
   * Именно эту величину человек называет «отзывчивостью», и с числом кадров она
   * связана лишь отчасти.
   */
  readonly clickToPhotonMs: Maybe<number>;
  /** То же, но по любому вводу, а не только по клику. */
  readonly allInputToPhotonMs: Maybe<number>;
  /** Кадр не дошёл до экрана. */
  readonly dropped: Maybe<boolean>;
}

/** Записанная сессия целиком. */
export interface FrameCapture {
  readonly applicationName: string;
  readonly processId: Maybe<number>;
  readonly frames: readonly FrameSample[];
  /** Из каких колонок читали — по ним видно, каких метрик не будет. */
  readonly availableColumns: readonly string[];
}
