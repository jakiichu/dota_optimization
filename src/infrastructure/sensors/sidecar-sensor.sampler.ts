import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { SensorSampler } from '../../application/ports/sensor-sampler.port.ts';
import type { GpuVendor, Maybe } from '../../domain/snapshot/system-snapshot.ts';
import type {
  GpuReading,
  NetworkProbe,
  SensorSample,
} from '../../domain/telemetry/sensor-sample.ts';
import { RESOURCES } from '../paths/resources.ts';
import { runJsonProducingProcess } from '../process/json-process.runner.ts';

const SIDECAR_PATH = RESOURCES.sidecar();

const BUILD_HINT = 'Соберите его: npm run sidecar:build';

/**
 * Читает показания через .NET-сайдкар.
 *
 * NVML и счётчики производительности живут в мире Windows-библиотек, куда из
 * Node не дотянуться без нативных аддонов. Сайдкар — отдельный процесс, который
 * запускается на время замера и пишет JSON; ни одного долгоживущего сервиса и
 * ни одного кернел-драйвера.
 */
export class SidecarSensorSampler implements SensorSampler {
  async sample(): Promise<SensorSample> {
    await ensureBuilt();
    const raw = await runJsonProducingProcess(
      SIDECAR_PATH,
      (outputPath) => ['probe', '--output', outputPath],
      { label: 'frameloss-sidecar probe' },
    );
    return toSensorSample(raw);
  }
}

async function ensureBuilt(): Promise<void> {
  try {
    await access(SIDECAR_PATH, constants.X_OK);
  } catch {
    throw new Error(`Сайдкар не найден: ${SIDECAR_PATH}\n${BUILD_HINT}`);
  }
}

// --- разбор ответа ----------------------------------------------------------

const VENDORS: readonly GpuVendor[] = ['nvidia', 'amd', 'intel', 'unknown'];

export function toSensorSample(raw: unknown): SensorSample {
  const root = asRecord(raw);
  if (root === null) {
    throw new TypeError('Сайдкар вернул не объект.');
  }

  return {
    capturedAt: asString(root['capturedAt']) ?? new Date().toISOString(),
    qpcTimestamp: asNumber(root['qpcTimestamp']) ?? 0,
    qpcFrequency: asNumber(root['qpcFrequency']) ?? 0,
    gpus: asArray(root['gpus']).map(toGpuReading),
    network: asArray(root['network']).map(toNetworkProbe),
    errors: asArray(root['errors'])
      .map((entry) => asString(entry))
      .filter((entry): entry is string => entry !== null),
  };
}

function toNetworkProbe(raw: unknown): NetworkProbe {
  const record = asRecord(raw) ?? {};
  return {
    target: asString(record['target']) ?? 'unknown',
    label: asString(record['label']) ?? 'unknown',
    roundTripMs: asNumber(record['roundTripMs']),
    success: record['success'] === true,
    status: asString(record['status']),
  };
}

function toGpuReading(raw: unknown): GpuReading {
  const record = asRecord(raw) ?? {};
  const vendor = asString(record['vendor']);
  return {
    adapterName: asString(record['adapterName']) ?? 'unknown',
    vendor: VENDORS.find((known) => known === vendor) ?? 'unknown',
    source: asString(record['source']) ?? 'unknown',
    temperatureC: asNumber(record['temperatureC']),
    coreClockMhz: asNumber(record['coreClockMhz']),
    memoryClockMhz: asNumber(record['memoryClockMhz']),
    powerWatts: asNumber(record['powerWatts']),
    powerLimitWatts: asNumber(record['powerLimitWatts']),
    memoryUsedBytes: asNumber(record['memoryUsedBytes']),
    memoryTotalBytes: asNumber(record['memoryTotalBytes']),
    utilizationPercent: asNumber(record['utilizationPercent']),
    throttleReasons: asArray(record['throttleReasons'])
      .map((entry) => asString(entry))
      .filter((entry): entry is string => entry !== null),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function asString(value: unknown): Maybe<string> {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asNumber(value: unknown): Maybe<number> {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
