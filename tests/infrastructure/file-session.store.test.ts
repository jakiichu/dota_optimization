import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_PASSPORT } from '../../src/domain/snapshot/machine-passport.ts';
import { METRICS_VERSION } from '../../src/domain/telemetry/capture-analysis.ts';
import type { FrameCapture } from '../../src/domain/telemetry/frame-sample.ts';
import { FileSessionStore } from '../../src/infrastructure/sessions/file-session.store.ts';
import type { CaptureScene } from '../../src/domain/telemetry/capture-scene.ts';
import { frameTrace } from '../support/frame-builder.ts';

const SCENE: CaptureScene = {
  kind: 'replay',
  replayFile: '8937378139.dem',
  startTick: 40000,
  note: null,
};

function capture(): FrameCapture {
  return {
    applicationName: 'dota2.exe',
    processId: 1234,
    frames: frameTrace(new Array<number>(200).fill(16.6)),
    availableColumns: ['FrameTime'],
  };
}

describe('FileSessionStore', () => {
  let directory: string;
  let store: FileSessionStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'frameloss-store-'));
    store = new FileSessionStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('сохраняет запись и находит её в списке', async () => {
    const saved = await store.save('до правки', SCENE, EMPTY_PASSPORT, capture(), []);
    const list = await store.list();

    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(saved.id);
    expect(list[0]?.label).toBe('до правки');
  });

  it('подставляет имя приложения вместо пустой подписи', async () => {
    const saved = await store.save('   ', SCENE, EMPTY_PASSPORT, capture(), []);

    expect(saved.label).toBe('dota2.exe');
  });

  it('хранит сырые кадры, а не посчитанные метрики', async () => {
    // Метрики в файле законсервировали бы версию кода: новый детектор пришлось
    // бы применять к каждому файлу руками.
    const saved = await store.save('запись', SCENE, EMPTY_PASSPORT, capture(), []);
    const raw = JSON.parse(await readFile(join(directory, `${saved.id}.json`), 'utf8'));

    expect(raw.record.capture.frames).toHaveLength(200);
    expect(raw.record).not.toHaveProperty('statistics');
    expect(raw.record).not.toHaveProperty('correlation');
  });

  it('пересчитывает сводку, посчитанную прошлой версией метрик', async () => {
    const saved = await store.save('запись', SCENE, EMPTY_PASSPORT, capture(), []);
    const path = join(directory, `${saved.id}.json`);

    // Подделываем файл так, будто его записала прошлая версия с чужими числами.
    const stored = JSON.parse(await readFile(path, 'utf8'));
    stored.record.metricsVersion = METRICS_VERSION - 1;
    stored.summary.averageFps = 1;
    await writeFile(path, JSON.stringify(stored), 'utf8');

    const list = await store.list();

    expect(list[0]?.averageFps).toBeCloseTo(60, 0);
    const refreshed = JSON.parse(await readFile(path, 'utf8'));
    expect(refreshed.record.metricsVersion).toBe(METRICS_VERSION);
  });

  it('читает файл первой версии, где метрики лежали внутри', async () => {
    // Выбросить такую запись было бы хуже, чем прочитать её без сенсоров.
    const legacy = {
      summary: {
        id: 'старая-запись',
        label: 'бой',
        capturedAt: '2026-09-08T20:00:00.000Z',
        application: 'dota2.exe',
        durationSeconds: 3.3,
        frameCount: 200,
        averageFps: 60,
        frameTime: { p50: 16.6, p95: 16.6, p99: 16.6, p999: 16.6 },
        inputLatency: null,
        stutterCount: 0,
        stuttersPerMinute: 0,
        bottleneck: 'unknown',
        scene: { kind: 'unknown', replayFile: null, startTick: null, note: null },
      },
      result: { capture: capture() },
    };
    await writeFile(join(directory, 'старая-запись.json'), JSON.stringify(legacy), 'utf8');

    const record = await store.load('старая-запись');

    expect(record.capture.frames).toHaveLength(200);
    // Сырых замеров в старом формате не было — честно пусто.
    expect(record.sensors).toEqual([]);
    expect(record.metricsVersion).toBe(METRICS_VERSION);
  });

  it('дополняет запись полями, которых не было в её версии', async () => {
    // Файл переживает несколько версий модели, а читается как обычный JSON без
    // проверок: замер без поля сети роняет разбор на первом же цикле по нему.
    // С процессами то же самое, но дополнять их надо не пустым списком, а
    // `null`: в старой записи их не собирали, и «никто не был занят» по ней
    // сказать нельзя.
    const saved = await store.save('запись', SCENE, EMPTY_PASSPORT, capture(), []);
    const path = join(directory, `${saved.id}.json`);

    const stored = JSON.parse(await readFile(path, 'utf8'));
    stored.record.sensors = [
      {
        capturedAt: '2026-09-08T00:00:00Z',
        qpcTimestamp: 1,
        qpcFrequency: 1,
        gpus: [],
        cpu: { utilizationPercent: 30, performancePercent: 99, coreUtilizationPercent: [] },
        errors: [],
      },
    ];
    delete stored.record.scene;
    await writeFile(path, JSON.stringify(stored), 'utf8');

    const record = await store.load(saved.id);

    expect(record.sensors[0]?.network).toEqual([]);
    expect(record.sensors[0]?.processes).toBeNull();
    expect(record.sensors[0]?.cpu?.throttleReasons).toEqual([]);
    expect(record.scene.kind).toBe('unknown');

    // И весь путь чтения целиком: список пересчитывает сводку новыми метриками,
    // то есть прогоняет старый замер через все нынешние детекторы.
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it('не даёт идентификатору увести запись в соседний каталог', async () => {
    await expect(store.load('../../тайное')).rejects.toThrow();
    // Разделитель пути Windows — тот же обход, только с другим символом.
    await expect(store.load('вложенное\\файл')).rejects.toThrow();
    await expect(store.load('C:секрет')).rejects.toThrow();
  });

  it('не калечит имя с кириллицей', async () => {
    // Замена «недопустимых» символов молча превращала такое имя в
    // подчёркивания, и файл потом не находился.
    const saved = await store.save('запись', SCENE, EMPTY_PASSPORT, capture(), []);

    await expect(store.load(saved.id)).resolves.toBeDefined();
  });

  it('возвращает пустой список, когда записей ещё не делали', async () => {
    const empty = new FileSessionStore(join(directory, 'нет-такого'));

    expect(await empty.list()).toEqual([]);
  });
});
