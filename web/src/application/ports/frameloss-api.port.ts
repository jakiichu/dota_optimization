import type {
  Audit,
  Capture,
  Comparison,
  SensorSample,
  SessionSummary,
} from '../../domain/models.ts';

export interface CaptureRequest {
  readonly processName: string;
  readonly seconds: number;
  readonly label: string;
}

/**
 * Доступ к данным приложения.
 *
 * Экраны зависят от этого интерфейса, а не от `fetch`: так их можно и
 * подменить в тестах, и перевести на другой транспорт, не трогая ни одной
 * кнопки.
 */
export interface FramelossApi {
  fetchAudit(signal: AbortSignal): Promise<Audit>;
  fetchSessions(signal: AbortSignal): Promise<readonly SessionSummary[]>;
  fetchComparison(
    beforeId: string,
    afterId: string,
    signal: AbortSignal,
  ): Promise<Comparison>;
  analyzeSession(id: string, signal: AbortSignal): Promise<Capture>;
  runCapture(request: CaptureRequest, signal: AbortSignal): Promise<Capture>;

  /**
   * Поток живых замеров.
   *
   * Не запрос, а подписка: данные текут сами, и кешировать их незачем.
   * Возвращает функцию отписки.
   */
  subscribeToSensors(
    onSample: (sample: SensorSample) => void,
    onError: (message: string) => void,
  ): () => void;
}
