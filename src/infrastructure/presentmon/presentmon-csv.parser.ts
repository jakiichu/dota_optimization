import type { Maybe } from '../../domain/snapshot/system-snapshot.ts';
import type { FrameCapture, FrameSample } from '../../domain/telemetry/frame-sample.ts';

/**
 * Разбор CSV от PresentMon.
 *
 * Колонки читаются по именам из заголовка, а не по позициям: набор метрик
 * меняется и от версии PresentMon, и от флагов запуска (`--no_track_gpu`,
 * `--v1_metrics`). Неизвестные колонки игнорируем, отсутствующие превращаются в
 * `null` — то же соглашение, что и везде: `null` значит «не измерили».
 */

/** Имена одной и той же величины в разных версиях PresentMon. */
const COLUMN_ALIASES = {
  application: ['Application'],
  processId: ['ProcessID'],
  frameTime: ['FrameTime', 'msBetweenPresents'],
  cpuBusy: ['CPUBusy'],
  gpuBusy: ['GPUBusy', 'GPUTime'],
  displayLatency: ['DisplayLatency', 'msUntilDisplayed'],
  presentMode: ['PresentMode'],
  dropped: ['Dropped'],
} as const;

/** PresentMon пишет так там, где метрика недоступна. */
const NOT_AVAILABLE = 'NA';

const MS_IN_SECOND = 1000;

type ColumnKey = keyof typeof COLUMN_ALIASES;

export class PresentMonCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresentMonCsvError';
  }
}

export function parsePresentMonCsv(text: string): FrameCapture {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headerLine = lines[0];
  if (headerLine === undefined) {
    throw new PresentMonCsvError('PresentMon не вернул ни одной строки.');
  }

  const header = splitCsvLine(headerLine);
  const columns = mapColumns(header);
  if (columns.frameTime === undefined) {
    throw new PresentMonCsvError(
      `В выводе PresentMon нет колонки времени кадра. Заголовок: ${header.join(', ')}`,
    );
  }

  const frames: FrameSample[] = [];
  let applicationName = 'unknown';
  let processId: Maybe<number> = null;
  let elapsedMs = 0;

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const frameTimeMs = readNumber(cells, columns.frameTime);
    // Строка без времени кадра — это не кадр: заголовок повторно, обрывок, мусор.
    if (frameTimeMs === null) continue;

    applicationName = readText(cells, columns.application) ?? applicationName;
    processId ??= readNumber(cells, columns.processId);

    frames.push({
      startSeconds: elapsedMs / MS_IN_SECOND,
      frameTimeMs,
      cpuBusyMs: readNumber(cells, columns.cpuBusy),
      gpuBusyMs: readNumber(cells, columns.gpuBusy),
      displayLatencyMs: readNumber(cells, columns.displayLatency),
      presentMode: readText(cells, columns.presentMode),
      dropped: readBoolean(cells, columns.dropped),
    });

    // Ось времени набираем из самих кадров, а не из колонки времени: она в
    // разных версиях и при разных флагах — то секунды, то тики QPC, то дата.
    // Время между презентами от формата не зависит.
    elapsedMs += frameTimeMs;
  }

  return {
    applicationName,
    processId,
    frames,
    availableColumns: header,
  };
}

// --- заголовок --------------------------------------------------------------

type ColumnIndex = Partial<Record<ColumnKey, number>>;

function mapColumns(header: readonly string[]): ColumnIndex {
  const normalized = header.map((name) => name.trim().toLowerCase());
  const columns: ColumnIndex = {};

  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    for (const alias of COLUMN_ALIASES[key]) {
      const index = normalized.indexOf(alias.toLowerCase());
      if (index !== -1) {
        columns[key] = index;
        break;
      }
    }
  }

  return columns;
}

// --- ячейки -----------------------------------------------------------------

function readCell(cells: readonly string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  const raw = cells[index]?.trim();
  if (raw === undefined || raw === '' || raw.toUpperCase() === NOT_AVAILABLE) return null;
  return raw;
}

function readNumber(cells: readonly string[], index: number | undefined): Maybe<number> {
  const raw = readCell(cells, index);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readText(cells: readonly string[], index: number | undefined): Maybe<string> {
  return readCell(cells, index);
}

function readBoolean(cells: readonly string[], index: number | undefined): Maybe<boolean> {
  const raw = readCell(cells, index);
  if (raw === null) return null;
  const lowered = raw.toLowerCase();
  if (lowered === '1' || lowered === 'true') return true;
  if (lowered === '0' || lowered === 'false') return false;
  return null;
}

/**
 * Разбирает строку CSV с учётом кавычек.
 *
 * Имя приложения теоретически может содержать запятую, и тогда простой split
 * сдвинул бы все последующие колонки — то есть тихо испортил бы все метрики.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char ?? '';
  }

  cells.push(current);
  return cells;
}
