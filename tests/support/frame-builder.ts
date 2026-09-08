import type { FrameSample } from '../../src/domain/telemetry/frame-sample.ts';

/**
 * Кадр, в котором ничего не измерено.
 *
 * Тест дописывает только то, что проверяет, — так видно, от каких полей
 * зависит поведение. Заодно новое поле в модели кадра больше не заставляет
 * править четыре набора фикстур подряд.
 */
const EMPTY: FrameSample = {
  startSeconds: 0,
  qpcMs: null,
  frameTimeMs: 0,
  cpuBusyMs: null,
  gpuBusyMs: null,
  displayLatencyMs: null,
  clickToPhotonMs: null,
  allInputToPhotonMs: null,
  presentMode: null,
  syncInterval: null,
  allowsTearing: null,
  dropped: null,
};

export function frameSample(overrides: Partial<FrameSample>): FrameSample {
  return { ...EMPTY, ...overrides };
}

/**
 * Раскладывает времена кадров по общей оси, накапливая их.
 *
 * `withQpc` добавляет абсолютное время от заданной точки: без него корреляция
 * с сенсорами не работает, и тесты на неё должны это учитывать.
 */
export function frameTrace(
  frameTimes: readonly number[],
  fill: (frameTimeMs: number) => Partial<FrameSample> = () => ({}),
  originQpcMs: number | null = null,
): FrameSample[] {
  let elapsedMs = 0;
  return frameTimes.map((frameTimeMs) => {
    const frame = frameSample({
      startSeconds: elapsedMs / 1000,
      qpcMs: originQpcMs === null ? null : originQpcMs + elapsedMs,
      frameTimeMs,
      ...fill(frameTimeMs),
    });
    elapsedMs += frameTimeMs;
    return frame;
  });
}
