import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeFrameStatistics } from '../../src/domain/telemetry/frame-metrics.ts';
import { parsePresentMonCsv } from '../../src/infrastructure/presentmon/presentmon-csv.parser.ts';

/**
 * Настоящий вывод PresentMon 2.5.1 — снят с работающей Dota 2.
 *
 * Придуманные фикстуры уже один раз подвели: я угадал имя колонки времени как
 * `CPUStartTime`, а на деле с флагом `--qpc_time_ms` она называется
 * `CPUStartQPCTime`. Разбор молча возвращал null, корреляция с сенсорами не
 * работала, и заметить это можно было только запустив игру. Поэтому здесь
 * лежит кусок реального файла со всеми его особенностями — включая метку
 * порядка байтов в начале.
 */
const FIXTURE = readFileSync(
  fileURLToPath(new URL('../fixtures/presentmon-2.5.1-dota2.csv', import.meta.url)),
  'utf8',
);

describe('настоящая запись PresentMon 2.5.1', () => {
  const capture = parsePresentMonCsv(FIXTURE, { timeColumnIsQpcMs: true });

  it('распознаёт приложение, несмотря на метку порядка байтов в заголовке', () => {
    expect(capture.applicationName).toBe('dota2.exe');
    expect(capture.processId).toBe(38188);
  });

  it('читает абсолютное время из колонки CPUStartQPCTime', () => {
    // Ровно то, на чём разбор споткнулся при первом живом запуске.
    expect(capture.frames[0]?.qpcMs).toBeCloseTo(291934196.0434, 3);
    expect(capture.frames[1]?.qpcMs).toBeGreaterThan(capture.frames[0]?.qpcMs ?? 0);
  });

  it('читает разбивку кадра по CPU и GPU', () => {
    const frame = capture.frames[0];

    expect(frame?.frameTimeMs).toBeCloseTo(32.3585, 4);
    expect(frame?.cpuBusyMs).toBeCloseTo(32.2124, 4);
    expect(frame?.gpuBusyMs).toBeCloseTo(7.457, 4);
    expect(frame?.displayLatencyMs).toBeCloseTo(40.4343, 4);
    expect(frame?.presentMode).toBe('Hardware: Independent Flip');
  });

  it('оставляет инпут-лаг пустым, когда ввода за запись не было', () => {
    // В CSV там NA. Отсутствие ввода — не нулевая задержка.
    expect(capture.frames[0]?.clickToPhotonMs).toBeNull();
    expect(computeFrameStatistics(capture.frames).inputLatency).toBeNull();
  });

  it('делает по этой записи вывод об упоре в процессор', () => {
    // CPU занимает 99.5% кадра, GPU — 23%. Именно так Dota и ведёт себя в меню.
    const statistics = computeFrameStatistics(capture.frames);

    expect(statistics.bottleneck.kind).toBe('cpu');
    expect(statistics.bottleneck.gpuBusyShare).toBeLessThan(0.3);
  });

  it('строит ось графика от первого кадра, а не от загрузки системы', () => {
    expect(capture.frames[0]?.startSeconds).toBe(0);
    expect(capture.frames.at(-1)?.startSeconds).toBeLessThan(1);
  });
});
