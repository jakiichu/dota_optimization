export type Severity = 'critical' | 'warning' | 'unknown' | 'info' | 'ok';

export interface FindingView {
  ruleId: string;
  title: string;
  severity: Severity;
  summary: string;
  observed: string;
  expected: string;
  impact: string;
  remediation: string[];
}

export interface MachineView {
  name: string;
  os: string;
  cpu: string;
  gpu: string;
  displays: string[];
  games: string[];
  collectedAsAdmin: boolean;
  capturedAt: string;
}

export interface AuditView {
  machine: MachineView;
  findings: FindingView[];
  counts: Record<Severity, number>;
  collectionErrors: string[];
}

export interface GpuReadingView {
  adapterName: string;
  displayName: string;
  source: string;
  utilizationPercent: number | null;
  temperatureC: number | null;
  coreClockMhz: number | null;
  powerWatts: number | null;
  memoryUsedMib: number | null;
  memoryTotalMib: number | null;
  throttleReasons: string[];
}

export interface SensorSampleView {
  elapsedSeconds: number;
  gpus: GpuReadingView[];
  errors: string[];
}

export async function fetchAudit(signal: AbortSignal): Promise<AuditView> {
  const response = await fetch('/api/audit', { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(errorMessageOf(body) ?? `Сервер ответил ${response.status}.`);
  }
  return (await response.json()) as AuditView;
}

function errorMessageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body as { error: unknown };
  return typeof error === 'string' ? error : null;
}

/**
 * Подписка на поток сенсоров.
 *
 * EventSource переподключается сам, если сервер уронил соединение, — для
 * локального сервера, который может перезапуститься, это ровно то поведение,
 * которое нужно.
 */
export function subscribeToSensors(
  onSample: (sample: SensorSampleView) => void,
  onError: (message: string) => void,
): () => void {
  const source = new EventSource('/api/sensors/stream');

  source.onmessage = (event) => {
    try {
      onSample(JSON.parse(event.data) as SensorSampleView);
    } catch {
      // Оборванная строка — не повод рвать подписку.
    }
  };
  source.onerror = () => onError('Соединение с сервером потеряно, переподключаюсь…');

  return () => source.close();
}
