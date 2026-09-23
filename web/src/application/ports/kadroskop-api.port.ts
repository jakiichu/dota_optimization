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
export interface KadroskopApi {
  /** Сохранить локально сформированный HTML-отчёт на рабочий стол. */
  exportReport(html: string): Promise<string>;
  /**
   * Версия сборки.
   *
   * Отдельным запросом, а не полем в аудите: версия — свойство приложения, а не
   * машины, и подмешивать её к снимку железа значило бы однажды искать её там.
   */
  fetchVersion(signal?: AbortSignal): Promise<string>;
  fetchAudit(signal: AbortSignal): Promise<Audit>;
  fetchSessions(signal: AbortSignal): Promise<readonly SessionSummary[]>;
  fetchComparison(
    beforeId: string,
    afterId: string,
    signal: AbortSignal,
  ): Promise<Comparison>;
  fetchRepeatedComparison(beforeIds: readonly string[], afterIds: readonly string[], signal: AbortSignal): Promise<RepeatedComparison>;
  /** `window` задаёт кусок для графика; метрики от него не зависят. */
  analyzeSession(id: string, signal: AbortSignal, window?: FrameWindow): Promise<Capture>;
  runCapture(request: CaptureRequest, signal: AbortSignal): Promise<Capture>;
  fetchCaptureStatus(signal: AbortSignal): Promise<CaptureStatus>;
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

  /** Локальные Steam-профили и наличие персональной раскладки Dota. */
  fetchAccountControls(signal: AbortSignal): Promise<AccountControls>;
  /** Копирует раскладку с обязательной резервной копией существующего файла. */
  transferAccountControls(sourceId: string, targetId: string, mode?: SettingsTransferMode): Promise<ControlTransferResult>;

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
