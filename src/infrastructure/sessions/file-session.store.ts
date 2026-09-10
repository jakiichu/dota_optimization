import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionRecord, SessionStore } from '../../application/ports/session-store.port.ts';
import {
  analyzeCapture,
  METRICS_VERSION,
  summarize,
} from '../../domain/telemetry/capture-analysis.ts';
import {
  EMPTY_PASSPORT,
  type MachinePassport,
} from '../../domain/snapshot/machine-passport.ts';
import { UNKNOWN_SCENE, type CaptureScene } from '../../domain/telemetry/capture-scene.ts';
import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import type { SensorSample } from '../../domain/telemetry/sensor-sample.ts';
import type { SessionSummary } from '../../domain/telemetry/session-comparison.ts';

const EXTENSION = '.json';

/** Что лежит в файле: сырая запись плюс сводка как кеш для списка. */
interface StoredFile {
  readonly record: SessionRecord;
  readonly summary: SessionSummary;
}

/**
 * Файл первой версии: посчитанные метрики лежали внутри, а сырых замеров
 * сенсоров не было вовсе — сохранялось только их количество.
 */
interface LegacyStoredFile {
  readonly summary: SessionSummary;
  readonly result: { readonly capture: FrameCapture };
}

/**
 * Записи в виде json-файлов в каталоге.
 *
 * Никакой базы: файл можно приложить к сообщению, положить в issue или
 * разобрать руками. Для инструмента, который просит «пришли свою запись», это
 * важнее скорости выборки.
 *
 * Сводка хранится рядом с кадрами только как кеш. Если она посчитана прошлой
 * версией метрик, при чтении она пересчитывается и файл переписывается — так
 * новый детектор доходит до всего архива сам.
 */
export class FileSessionStore implements SessionStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  async save(
    label: string,
    scene: CaptureScene,
    passport: MachinePassport,
    capture: FrameCapture,
    sensors: readonly SensorSample[],
  ): Promise<SessionSummary> {
    await mkdir(this.#directory, { recursive: true });

    const record: SessionRecord = {
      id: newId(capture.applicationName),
      label,
      capturedAt: new Date().toISOString(),
      metricsVersion: METRICS_VERSION,
      capture,
      sensors,
      passport,
      scene,
    };

    const summary = summarizeRecord(record);
    await this.#write({ record, summary });
    return summary;
  }

  async list(): Promise<readonly SessionSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch {
      // Каталога ещё нет — записей просто не делали.
      return [];
    }

    const summaries: SessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(EXTENSION)) continue;
      try {
        const stored = await this.#readAndRefresh(name.slice(0, -EXTENSION.length));
        summaries.push(stored.summary);
      } catch {
        // Битый файл не должен прятать остальные записи.
      }
    }

    return summaries.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  }

  async load(id: string): Promise<SessionRecord> {
    return (await this.#readAndRefresh(id)).record;
  }

  /**
   * Читает файл и, если сводка от прошлой версии метрик, пересчитывает её.
   *
   * Пересчёт ленивый — при первом обращении. Перебирать весь каталог на старте
   * значило бы читать мегабайты кадров ради записей, на которые никто не
   * посмотрит.
   */
  async #readAndRefresh(id: string): Promise<StoredFile> {
    const raw = await readFile(this.#path(id), 'utf8');
    const stored = migrate(JSON.parse(raw) as StoredFile | LegacyStoredFile);

    if (stored.record.metricsVersion === METRICS_VERSION) {
      return stored;
    }

    const record: SessionRecord = { ...stored.record, metricsVersion: METRICS_VERSION };
    const refreshed: StoredFile = { record, summary: summarizeRecord(record) };
    await this.#write(refreshed);
    return refreshed;
  }

  async #write(stored: StoredFile): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await writeFile(this.#path(stored.record.id), JSON.stringify(stored), 'utf8');
  }

  #path(id: string): string {
    return join(this.#directory, `${assertSafeId(id)}${EXTENSION}`);
  }
}

/**
 * Приводит файл первой версии к нынешнему виду.
 *
 * Кадры в нём есть, а сырых замеров сенсоров нет — они не сохранялись. Значит,
 * корреляция по такой записи будет без улик от железа, и это честнее, чем
 * выбросить запись целиком.
 */
function migrate(stored: StoredFile | LegacyStoredFile): StoredFile {
  if ('record' in stored) {
    return { ...stored, record: normalizeRecord(stored.record) };
  }

  const record: SessionRecord = {
    id: stored.summary.id,
    label: stored.summary.label,
    capturedAt: stored.summary.capturedAt,
    // Версию ставим нулевую, чтобы сводка пересчиталась текущими метриками.
    metricsVersion: 0,
    capture: stored.result.capture,
    sensors: [],
    // Старые записи делались до того, как сцена стала частью записи. Считать
    // их какой-то конкретной сценой нельзя — сравнивать их теперь не выйдет,
    // и это честнее, чем выдумать им сцену задним числом.
    scene: UNKNOWN_SCENE,
    // Состояние машины задним числом тоже не восстановить: конфиг с тех пор
    // могли поменять десять раз.
    passport: EMPTY_PASSPORT,
  };

  return { record, summary: stored.summary };
}

/**
 * Дополняет запись полями, которых не было в её версии.
 *
 * Файл на диске пережил несколько версий модели, а разбирается он как обычный
 * JSON без проверок. Замеры сенсоров из прошлых версий не знают ни про сеть, ни
 * про процессы, и без этих полей разбор падает на первом же цикле по ним.
 *
 * Процессы дополняются именно `null`, а не пустым списком: в старой записи их
 * действительно не собирали, и сказать по ней «никто не был занят» нельзя.
 */
function normalizeRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    scene: record.scene ?? UNKNOWN_SCENE,
    passport: record.passport ?? EMPTY_PASSPORT,
    sensors: (record.sensors ?? []).map((sample) => ({
      ...sample,
      network: sample.network ?? [],
      processes: sample.processes ?? null,
    })),
  };
}

function summarizeRecord(record: SessionRecord): SessionSummary {
  return summarize(
    record.id,
    record.label,
    record.capturedAt,
    record.capture,
    analyzeCapture(record.capture, record.sensors),
    record.scene ?? UNKNOWN_SCENE,
    record.passport ?? EMPTY_PASSPORT,
  );
}

/** Разделители пути и переход на уровень выше — всё, что реально опасно. */
const UNSAFE_IN_ID = /[/\\:*?"<>|]|\.\./;

/**
 * Идентификатор — это же и имя файла, поэтому опасное в нём запрещено.
 *
 * Именно запрещено, а не вычищено: замена недопустимых символов калечила имя
 * молча. Кириллица в имени приложения превращалась в подчёркивания, файл потом
 * не находился, а два разных имени могли схлопнуться в одно.
 */
function assertSafeId(id: string): string {
  if (id.trim() === '' || UNSAFE_IN_ID.test(id)) {
    throw new Error(`Недопустимый идентификатор записи: ${id}`);
  }
  return id;
}

function newId(application: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${application.replace(/\.exe$/i, '')}`;
}
