import type {
  Audit,
  BenchmarkOptions,
  Capture,
  Comparison,
  ConfigEdit,
  FrameWindow,
  GameConfig,
  Hypothesis,
  RecommendationKind,
  ReplayRun,
  ReplayRunState,
  SensorSample,
  SessionSummary,
} from '../../domain/models.ts';

export interface CaptureRequest {
  readonly processName: string;
  readonly seconds: number;
  readonly label: string;
  /**
   * Писать, пока идёт игра.
   *
   * Длительность тогда становится верхней границей: длину матча заранее не
   * знает никто.
   */
  readonly wholeGame: boolean;
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
  /** `window` задаёт кусок для графика; метрики от него не зависят. */
  analyzeSession(id: string, signal: AbortSignal, window?: FrameWindow): Promise<Capture>;
  runCapture(request: CaptureRequest, signal: AbortSignal): Promise<Capture>;
  /** Прекратить идущую запись досрочно. */
  stopCapture(): Promise<void>;

  /** Что можно запустить эталонным прогоном и что уже запущено. */
  fetchBenchmark(signal: AbortSignal): Promise<BenchmarkOptions>;
  /** Запускает игру с выбранным повтором. */
  launchReplayRun(run: ReplayRun): Promise<ReplayRunState>;

  /** Гипотезы: заведённые, проверенные и их приговоры. */
  fetchHypotheses(signal: AbortSignal): Promise<readonly Hypothesis[]>;
  /** Заводит гипотезу по рекомендации из записи. */
  recordHypothesis(sessionId: string, kind: RecommendationKind): Promise<Hypothesis>;
  /** Объявляет запись «после» и получает приговор. */
  settleHypothesis(id: string, afterSessionId: string): Promise<Hypothesis>;
  forgetHypothesis(id: string): Promise<readonly Hypothesis[]>;

  fetchConfig(signal: AbortSignal): Promise<GameConfig>;
  /** Точечные правки поверх текущего файла — так комментарии остаются на месте. */
  applyConfigEdits(edits: readonly ConfigEdit[]): Promise<GameConfig>;
  /** Замена файла целиком: конфиг принесли с другой машины или вставили текстом. */
  replaceConfig(text: string): Promise<GameConfig>;
  removeConfig(): Promise<GameConfig>;
  /** Кладёт копию на рабочий стол и возвращает путь к ней. */
  exportConfig(): Promise<string>;

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
