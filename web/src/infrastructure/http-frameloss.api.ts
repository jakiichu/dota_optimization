import type {
  CaptureRequest,
  FramelossApi,
} from '../application/ports/frameloss-api.port.ts';
import type {
  Audit,
  BenchmarkOptions,
  Capture,
  Comparison,
  ConfigEdit,
  GameConfig,
  ReplayRun,
  ReplayRunState,
  SensorSample,
  SessionSummary,
} from '../domain/models.ts';

/**
 * Доступ к данным через локальный сервер приложения.
 *
 * Единственное место, которое знает про HTTP, адреса и формат ответа. Экраны
 * про это не знают вовсе — они видят только порт.
 */
export class HttpFramelossApi implements FramelossApi {
  async fetchAudit(signal: AbortSignal): Promise<Audit> {
    return getJson<Audit>('/api/audit', signal);
  }

  async fetchSessions(signal: AbortSignal): Promise<readonly SessionSummary[]> {
    const body = await getJson<{ sessions: SessionSummary[] }>('/api/sessions', signal);
    return body.sessions;
  }

  async fetchComparison(
    beforeId: string,
    afterId: string,
    signal: AbortSignal,
  ): Promise<Comparison> {
    const query = new URLSearchParams({ before: beforeId, after: afterId });
    return getJson<Comparison>(`/api/sessions/compare?${query.toString()}`, signal);
  }

  async analyzeSession(id: string, signal: AbortSignal): Promise<Capture> {
    const query = new URLSearchParams({ id });
    return getJson<Capture>(`/api/sessions/analyze?${query.toString()}`, signal);
  }

  async runCapture(request: CaptureRequest, signal: AbortSignal): Promise<Capture> {
    const query = new URLSearchParams({
      process: request.processName,
      seconds: String(request.seconds),
      label: request.label,
    });
    return getJson<Capture>(`/api/capture?${query.toString()}`, signal);
  }

  async fetchBenchmark(signal: AbortSignal): Promise<BenchmarkOptions> {
    return getJson<BenchmarkOptions>('/api/benchmark', signal);
  }

  async launchReplayRun(run: ReplayRun): Promise<ReplayRunState> {
    return postJson<ReplayRunState>('/api/benchmark/launch', run);
  }

  async fetchConfig(signal: AbortSignal): Promise<GameConfig> {
    return getJson<GameConfig>('/api/config', signal);
  }

  async applyConfigEdits(edits: readonly ConfigEdit[]): Promise<GameConfig> {
    return postJson<GameConfig>('/api/config/apply', { changes: edits });
  }

  async replaceConfig(text: string): Promise<GameConfig> {
    return postJson<GameConfig>('/api/config/replace', { text });
  }

  async removeConfig(): Promise<GameConfig> {
    return postJson<GameConfig>('/api/config/remove', {});
  }

  async exportConfig(): Promise<string> {
    const body = await postJson<{ path: string }>('/api/config/export', {});
    return body.path;
  }

  /**
   * Поток замеров через SSE.
   *
   * `EventSource` сам переподключается, если сервер перезапустился, — для
   * локального приложения это ровно то поведение, которое нужно.
   */
  subscribeToSensors(
    onSample: (sample: SensorSample) => void,
    onError: (message: string) => void,
  ): () => void {
    const source = new EventSource('/api/sensors/stream');

    source.onmessage = (event) => {
      try {
        onSample(JSON.parse(event.data) as SensorSample);
      } catch {
        // Оборванная строка — не повод рвать подписку.
      }
    };
    source.onerror = () => onError('Соединение с сервером потеряно, переподключаюсь…');

    return () => source.close();
  }
}

/**
 * Изменяющий запрос.
 *
 * Без сигнала отмены намеренно: правку конфига нельзя бросить на полпути
 * только потому, что человек ушёл с экрана. Файл уже записан, и интерфейс
 * обязан узнать, чем всё кончилось.
 *
 * Тип application/json здесь не формальность: сервер по нему и отличает наш
 * запрос от подделанной чужой страницей формы, которая такой заголовок
 * выставить не может.
 */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure: unknown = await response.json().catch(() => null);
    throw new Error(errorMessageOf(failure) ?? `Сервер ответил ${response.status}.`);
  }
  return (await response.json()) as T;
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(errorMessageOf(body) ?? `Сервер ответил ${response.status}.`);
  }
  return (await response.json()) as T;
}

/** Сервер кладёт причину в поле error — показать её полезнее, чем код. */
function errorMessageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body as { error: unknown };
  return typeof error === 'string' ? error : null;
}
