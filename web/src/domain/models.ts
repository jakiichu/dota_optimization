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

export interface CaptureSeries {
  readonly time: readonly number[];
  readonly frameTimeMs: readonly number[];
  readonly stutterMs: readonly (number | null)[];
  readonly cpuBusyMs: readonly (number | null)[] | null;
  readonly gpuBusyMs: readonly (number | null)[] | null;
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
  readonly sensorSampleCount: number;
  readonly sessionId: string;
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

export interface MetricDelta {
  readonly label: string;
  readonly unit: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly share: number;
  readonly verdict: Verdict;
  readonly lowerIsBetter: boolean;
}

export interface Comparison {
  readonly before: SessionSummary;
  readonly after: SessionSummary;
  readonly metrics: readonly MetricDelta[];
  readonly bottleneckChanged: boolean;
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

export interface SensorSample {
  readonly elapsedSeconds: number;
  readonly gpus: readonly GpuReading[];
  readonly errors: readonly string[];
}
