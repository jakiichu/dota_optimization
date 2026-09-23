import type {
  CaptureRequest,
  KadroskopApi,
} from '../application/ports/kadroskop-api.port.ts';
import type {
  Audit,
  AccountControls,
  BenchmarkOptions,
  Capture,
  CaptureStatus,
  Comparison,
  ControlTransferResult,
  SettingsTransferMode,
  RepeatedComparison,
  ConfigEdit,
  FrameWindow,
  GameConfig,
  Hypothesis,
  RecommendationKind,
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
export class HttpKadroskopApi implements KadroskopApi {
  async exportReport(html: string): Promise<string> {
    const result = await postJson<{ path: string }>('/api/reports/export', { html });
    return result.path;
  }
  async fetchVersion(signal: AbortSignal): Promise<string> {
    const health = await getJson<{ version?: string }>('/api/health', signal);
    return health.version ?? 'неизвестна';
  }

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

  async fetchRepeatedComparison(beforeIds: readonly string[], afterIds: readonly string[], signal: AbortSignal): Promise<RepeatedComparison> {
    const query = new URLSearchParams({ mode: 'repeated' });
    beforeIds.forEach((id) => query.append('before', id));
    afterIds.forEach((id) => query.append('after', id));
    return getJson<RepeatedComparison>(`/api/sessions/compare?${query.toString()}`, signal);
  }

  async analyzeSession(
    id: string,
    signal: AbortSignal,
    window?: FrameWindow,
  ): Promise<Capture> {
    const query = new URLSearchParams({ id });
    if (window !== undefined) {
      query.set('from', String(window.fromSeconds));
      query.set('to', String(window.toSeconds));
    }
    return getJson<Capture>(`/api/sessions/analyze?${query.toString()}`, signal);
  }

  async runCapture(request: CaptureRequest, signal: AbortSignal): Promise<Capture> {
    const query = new URLSearchParams({
      process: request.processName,
      seconds: String(request.seconds),
      label: request.label,
    });
    if (request.wholeGame) query.set('whole', '1');
    return getJson<Capture>(`/api/capture?${query.toString()}`, signal);
  }

  async stopCapture(): Promise<void> {
    await postJson<{ stopping: boolean }>('/api/capture/stop', {});
  }

  async fetchCaptureStatus(signal: AbortSignal): Promise<CaptureStatus> {
    return getJson<CaptureStatus>('/api/capture/status', signal);
  }

  async fetchBenchmark(signal: AbortSignal): Promise<BenchmarkOptions> {
    return getJson<BenchmarkOptions>('/api/benchmark', signal);
  }

  async launchReplayRun(run: ReplayRun): Promise<ReplayRunState> {
    return postJson<ReplayRunState>('/api/benchmark/launch', run);
  }

  async fetchHypotheses(signal: AbortSignal): Promise<readonly Hypothesis[]> {
    const body = await getJson<{ hypotheses: Hypothesis[] }>('/api/hypotheses', signal);
    return body.hypotheses;
  }

  async recordHypothesis(sessionId: string, kind: RecommendationKind): Promise<Hypothesis> {
    return postJson<Hypothesis>('/api/hypotheses/record', { sessionId, kind });
  }

  async settleHypothesis(id: string, afterSessionId: string): Promise<Hypothesis> {
    return postJson<Hypothesis>('/api/hypotheses/settle', { id, afterSessionId });
  }

  async forgetHypothesis(id: string): Promise<readonly Hypothesis[]> {
    const body = await postJson<{ hypotheses: Hypothesis[] }>('/api/hypotheses/forget', { id });
    return body.hypotheses;
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

  async fetchAccountControls(signal: AbortSignal): Promise<AccountControls> {
    return getJson<AccountControls>('/api/account-controls', signal);
  }

  async transferAccountControls(
    sourceId: string,
    targetId: string,
    mode: SettingsTransferMode = 'controls',
  ): Promise<ControlTransferResult> {
    return postJson<ControlTransferResult>('/api/account-controls/transfer', {
      sourceId,
      targetId,
      mode,
    });
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
