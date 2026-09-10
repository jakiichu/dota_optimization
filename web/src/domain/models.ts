/**
 * Модель предметной области интерфейса.
 *
 * Это то, чем оперируют экраны: находки аудита, записи, замеры. Формы совпадают
 * с тем, что отдаёт сервер, но объявлены здесь — чтобы слой представления
 * зависел от своей модели, а не от формата чужого ответа.
 */

export type Severity = 'critical' | 'warning' | 'unknown' | 'info' | 'ok';

export interface Finding {
  readonly ruleId: string;
  readonly title: string;
  readonly severity: Severity;
  readonly summary: string;
  readonly observed: string;
  readonly expected: string;
  readonly impact: string;
  readonly remediation: readonly string[];
}

export interface Machine {
  readonly name: string;
  readonly os: string;
  readonly cpu: string;
  readonly gpu: string;
  readonly displays: readonly string[];
  readonly games: readonly string[];
  readonly collectedAsAdmin: boolean;
  readonly capturedAt: string;
}

export interface Audit {
  readonly machine: Machine;
  readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<Severity, number>>;
  readonly collectionErrors: readonly string[];
}

// --- телеметрия -------------------------------------------------------------

export interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly p999: number;
}

export type BottleneckKind = 'gpu' | 'cpu' | 'mixed' | 'limited' | 'unknown';

export interface Bottleneck {
  readonly kind: BottleneckKind;
  readonly gpuBusyShare: number | null;
  readonly cpuBusyShare: number | null;
  readonly explanation: string;
}

export interface Stutter {
  readonly frameIndex: number;
  readonly atSeconds: number;
  readonly frameTimeMs: number;
  readonly baselineMs: number;
  readonly ratio: number;
}

export type PacingSeverity = 'ok' | 'noticeable' | 'bad';

export interface PacingMultiple {
  readonly multiple: number;
  readonly frameCount: number;
  readonly share: number;
  readonly secondsSpent: number;
}

export interface FramePacing {
  readonly baseIntervalMs: number;
  readonly impliedHz: number;
  readonly nearestCommonHz: number | null;
  readonly multiples: readonly PacingMultiple[];
  readonly timeShareInLongFrames: number;
  readonly oscillation: number;
  readonly severity: PacingSeverity;
  readonly summary: string;
}

export type EvidenceKind =
  | 'gpu-work'
  | 'cpu-work'
  | 'waiting'
  | 'present-mode'
  | 'dropped'
  | 'gpu-idle'
  | 'vram-growth'
  | 'throttling';

export interface Evidence {
  readonly kind: EvidenceKind;
  readonly detail: string;
}

export interface CorrelatedStutter {
  readonly stutter: Stutter;
  readonly evidence: readonly Evidence[];
}

export interface CauseTally {
  readonly kind: EvidenceKind;
  readonly label: string;
  readonly count: number;
}

export interface Correlation {
  readonly stutters: readonly CorrelatedStutter[];
  readonly tally: readonly CauseTally[];
  readonly unexplained: number;
  readonly limitations: readonly string[];
}

export type NetworkSeverity = 'ok' | 'noticeable' | 'bad';

export interface NetworkTarget {
  readonly label: string;
  readonly target: string;
  readonly sampleCount: number;
  readonly medianMs: number | null;
  readonly worstMs: number | null;
  readonly jitterMs: number | null;
  readonly lossShare: number;
  readonly severity: NetworkSeverity;
}

export interface NetworkQuality {
  readonly measured: boolean;
  readonly targets: readonly NetworkTarget[];
  readonly severity: NetworkSeverity;
  readonly summary: string;
}

/**
 * Отметка статтера вместе с тем, чем он объясняется.
 *
 * Отдельным списком, а не колонкой в сериях: статтеров десятки, а точек тысячи,
 * и восемь параллельных массивов с одними `null` весили бы больше самих кадров.
 */
export interface StutterMark {
  /** Номер точки в сериях. */
  readonly index: number;
  readonly atSeconds: number;
  readonly frameTimeMs: number;
  /** Главная улика: ею красится точка. `null` — улик не нашлось. */
  readonly kind: EvidenceKind | null;
  /** Все улики словами и с числами. */
  readonly evidence: readonly string[];
}

export interface CaptureSeries {
  readonly time: readonly number[];
  readonly frameTimeMs: readonly number[];
  readonly stutterMs: readonly (number | null)[];
  /** Чем объясняется каждая отметка. */
  readonly stutterMarks: readonly StutterMark[];
  readonly cpuBusyMs: readonly (number | null)[] | null;
  readonly gpuBusyMs: readonly (number | null)[] | null;
  /**
   * Показаны не все кадры записи.
   *
   * Не усреднение: из каждого окна взяты настоящие самый короткий и самый
   * длинный кадры плюс все статтеры. Ни одно значение не выходит за
   * нарисованную огибающую — но точек меньше, чем кадров, и молчать нельзя.
   */
  readonly decimated: boolean;
  /** Сколько кадров стоит за этими точками. */
  readonly sourceFrameCount: number;
}

/** Кусок записи, показанный на графике. */
export interface FrameWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
}

export interface Capture {
  readonly application: string;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly averageFps: number;
  readonly frameTime: Percentiles;
  readonly inputLatency: Percentiles | null;
  readonly stutterCount: number;
  readonly stuttersPerMinute: number;
  readonly bottleneck: Bottleneck;
  readonly pacing: FramePacing;
  readonly worstStutters: readonly Stutter[];
  readonly series: CaptureSeries;
  readonly availableColumns: readonly string[];
  readonly correlation: Correlation;
  readonly network: NetworkQuality;
  readonly cpuLoad: CpuLoad;
  readonly recommendations: readonly Recommendation[];
  readonly sensorSampleCount: number;
  readonly sessionId: string;
}

// --- рекомендации -----------------------------------------------------------

export type RecommendationKind =
  | 'frame-cap'
  | 'cpu-relief'
  | 'gpu-relief'
  | 'present-mode'
  | 'not-config';

export type Confidence = 'measured' | 'likely';

export interface ConfigChange {
  readonly cvar: string;
  readonly value: string;
  readonly why: string;
}

/**
 * Проверяемая гипотеза, а не совет.
 *
 * `evidence` — числа из записи, `expect` — что должно сдвинуться, если
 * гипотеза верна. Без последнего рекомендацию нельзя опровергнуть, и она ничем
 * не отличается от списка из интернета.
 */
export interface Prediction {
  readonly metric: MetricId;
  readonly direction: 'down' | 'up';
  /** Метрика, которой позволено ухудшиться, — объявленная цена. */
  readonly cost: MetricId | null;
}

export interface Recommendation {
  readonly kind: RecommendationKind;
  readonly title: string;
  readonly evidence: string;
  readonly changes: readonly ConfigChange[];
  readonly expect: string;
  readonly risk: string;
  readonly confidence: Confidence;
  /** То же предсказание в числах. `null` — проверять нечего. */
  readonly prediction: Prediction | null;
}

// --- проверка гипотез -------------------------------------------------------

export type HypothesisOutcome =
  | 'confirmed'
  | 'refuted'
  | 'no-change'
  | 'not-comparable'
  | 'not-measured';

export interface HypothesisCheck {
  readonly outcome: HypothesisOutcome;
  readonly summary: string;
  readonly predicted: MetricDelta | null;
  readonly paid: MetricDelta | null;
  /** Предсказание сбылось, но просело что-то другое. */
  readonly betterOnPaper: boolean;
  /** Что именно просело, кроме объявленной цены. */
  readonly regressed: readonly MetricDelta[];
}

export interface HypothesisCandidate {
  readonly id: string;
  readonly comparable: boolean;
}

export interface Hypothesis {
  readonly id: string;
  readonly createdAt: string;
  readonly recommendation: Recommendation;
  readonly before: SessionSummary | null;
  readonly after: SessionSummary | null;
  readonly comparison: Comparison | null;
  readonly check: HypothesisCheck | null;
  /** Что поменялось сверх обещанного: опыт был нечистым. */
  readonly unexpected: readonly PassportChange[];
  readonly candidates: readonly HypothesisCandidate[];
}

// --- конфиг игры ------------------------------------------------------------

export type CvarImpact = 'gpu' | 'cpu' | 'both' | 'gameplay' | 'cosmetic' | 'none';

/** Чем править значение: переключателем, числом, цветом или полем. */
export type CvarValueKind = 'toggle' | 'color' | 'number' | 'text';

export interface ConfigSetting {
  readonly name: string;
  readonly value: string;
  readonly line: number;
  readonly kind: CvarValueKind;
  /** Что настройка делает. `null` — про эту мы не знаем. */
  readonly what: string | null;
  readonly cost: string | null;
  readonly impact: CvarImpact | 'unknown';
  /** Чего касается: «считает процессор», «рисует видеокарта». */
  readonly impactLabel: string;
  /** Как строка называется в меню игры. `null` — в меню её нет. */
  readonly inGame: InGameSetting | null;
  readonly known: boolean;
}

export interface InGameSetting {
  /** Текст из меню игры, на языке её интерфейса. */
  readonly label: string;
  /** Значение переменной обратно галочке в меню: `1` значит «выключено». */
  readonly inverted: boolean;
}

export type NoteSeverity = 'critical' | 'warning' | 'info';

export interface ConfigNote {
  readonly severity: NoteSeverity;
  readonly title: string;
  readonly detail: string;
  readonly remediation: readonly string[];
}

export interface ConfigTally {
  readonly impact: CvarImpact | 'unknown';
  readonly label: string;
  readonly count: number;
}

export interface GameConfig {
  /** Куда игра смотрит за конфигом. `null` — игру найти не удалось. */
  readonly path: string | null;
  readonly exists: boolean;
  readonly text: string;
  readonly settingCount: number;
  readonly settings: readonly ConfigSetting[];
  readonly unparsed: readonly string[];
  readonly notes: readonly ConfigNote[];
  readonly tally: readonly ConfigTally[];
  /** Куда уехала прежняя версия при последней правке. */
  readonly backupPath: string | null;
}

// --- эталонный прогон -------------------------------------------------------

export interface ReplayFile {
  readonly name: string;
  readonly sizeBytes: number;
  /** Длина повтора в тиках. `null` — файл её не сообщил. */
  readonly ticks: number | null;
  /** Она же в секундах — из самого файла, а не из зашитой частоты тиков. */
  readonly durationSeconds: number | null;
}

export interface ReplayRun {
  readonly replayFile: string;
  /** Тик, с которого мерить. `null` — повтор идёт с начала. */
  readonly startTick: number | null;
  readonly label: string;
}

export type ReplayRunStatus = 'idle' | 'starting' | 'running';

export interface ReplayRunState {
  /** `starting` — Steam попросили открыть игру, процесса ещё нет. */
  readonly status: ReplayRunStatus;
  /** Прогон, который идёт или запускается. `null` — запускали не мы. */
  readonly current: ReplayRun | null;
  /** Сколько секунд ждём появления игры. */
  readonly waitingSeconds: number | null;
  readonly configPath: string | null;
  readonly steps: readonly string[];
  /** Команда для консоли, если движок не остановился на тике. */
  readonly manualSeek: string | null;
  readonly gameRunning: boolean;
}

export interface BenchmarkOptions {
  readonly ready: boolean;
  /** Почему запустить нельзя. Пусто, когда всё на месте. */
  readonly obstacles: readonly string[];
  readonly replays: readonly ReplayFile[];
  readonly state: ReplayRunState;
}

/** Правка одной настройки. `value: null` — убрать её из файла. */
export interface ConfigEdit {
  readonly name: string;
  readonly value: string | null;
}

// --- записи и сравнение -----------------------------------------------------

export interface SessionSummary {
  readonly id: string;
  readonly label: string;
  readonly application: string;
  readonly capturedAt: string;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly averageFps: number;
  readonly frameTime: Percentiles;
  readonly inputLatency: Percentiles | null;
  readonly stutterCount: number;
  readonly stuttersPerMinute: number;
  readonly pacingTimeShare: number;
  readonly bottleneck: BottleneckKind;
}

export type Verdict = 'better' | 'worse' | 'same';

export type MetricId =
  | 'fps'
  | 'frameTimeP50'
  | 'frameTimeP99'
  | 'frameTimeP999'
  | 'pacing'
  | 'stutters'
  | 'inputLatency';

export interface MetricDelta {
  readonly id: MetricId;
  readonly label: string;
  readonly unit: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly share: number;
  readonly verdict: Verdict;
  readonly lowerIsBetter: boolean;
}

/** Настройка машины появилась, исчезла или поменяла значение. */
export interface PassportChange {
  readonly key: string;
  readonly label: string;
  /** `null` — настройки не было в первой записи. */
  readonly before: string | null;
  /** `null` — настройки нет во второй. */
  readonly after: string | null;
}

export interface Comparison {
  readonly before: SessionSummary;
  readonly after: SessionSummary;
  readonly metrics: readonly MetricDelta[];
  readonly bottleneckChanged: boolean;
  /**
   * Что между записями поменялось на машине.
   *
   * Пусто — либо ничего не меняли, либо записи сделаны до того, как мы стали
   * это запоминать.
   */
  readonly changes: readonly PassportChange[];
  readonly verdict: Verdict;
  readonly summary: string;
  readonly caveats: readonly string[];
}

// --- живые замеры -----------------------------------------------------------

export interface GpuReading {
  readonly adapterName: string;
  readonly displayName: string;
  readonly source: string;
  readonly utilizationPercent: number | null;
  readonly temperatureC: number | null;
  readonly coreClockMhz: number | null;
  readonly powerWatts: number | null;
  readonly memoryUsedMib: number | null;
  readonly memoryTotalMib: number | null;
  readonly throttleReasons: readonly string[];
}

export interface CpuReading {
  readonly utilizationPercent: number | null;
  /** Частота в процентах от базовой: выше ста — разгон, ниже — сброс. */
  readonly performancePercent: number | null;
  readonly threadCount: number;
  /** Сколько потоков занято целиком: понятнее процентов. */
  readonly busyThreads: number | null;
}

export interface SensorSample {
  readonly elapsedSeconds: number;
  readonly gpus: readonly GpuReading[];
  /** `null` — счётчики процессора недоступны, а не ноль загрузки. */
  readonly cpu: CpuReading | null;
  readonly errors: readonly string[];
}

/**
 * Что происходило с процессором за запись.
 *
 * «Упор в процессор» — вердикт верный, но бесполезный. Здесь он разложен на
 * «упёрлись в скорость одного ядра» и «процессор сбрасывал частоты»: действия
 * по ним разные.
 */
export interface CpuLoad {
  readonly measured: boolean;
  readonly utilizationPercent: number | null;
  readonly threadCount: number | null;
  readonly busyThreads: number | null;
  readonly performancePercent: number | null;
  readonly lowestPerformancePercent: number | null;
  readonly throttled: boolean;
  readonly singleThreadBound: boolean;
  readonly summary: string;
}
