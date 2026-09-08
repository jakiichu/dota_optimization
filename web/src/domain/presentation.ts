import type {
  BottleneckKind,
  EvidenceKind,
  NetworkSeverity,
  PacingSeverity,
  Severity,
  Verdict,
} from './models.ts';

/**
 * Как называются и чем окрашиваются состояния предметной области.
 *
 * Здесь, а не в компонентах: одна и та же важность встречается на четырёх
 * экранах, и расходиться в названиях они не должны. Функций рендера тут нет —
 * только соответствия, поэтому слой остаётся чистым.
 */

export const SEVERITY_ORDER: readonly Severity[] = [
  'critical',
  'warning',
  'unknown',
  'info',
  'ok',
];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'критично',
  warning: 'внимание',
  unknown: 'не проверено',
  info: 'к сведению',
  ok: 'в порядке',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warning)',
  unknown: 'var(--unknown)',
  info: 'var(--info)',
  ok: 'var(--ok)',
};

/** По умолчанию прячем то, что и так в порядке: экран должен показывать работу. */
export const DEFAULT_VISIBLE_SEVERITIES: readonly Severity[] = [
  'critical',
  'warning',
  'unknown',
  'info',
];

export const BOTTLENECK_LABEL: Record<BottleneckKind, string> = {
  gpu: 'Упор в видеокарту',
  cpu: 'Упор в процессор',
  mixed: 'Ограничитель меняется',
  limited: 'Работает ограничитель кадров',
  unknown: 'Определить не удалось',
};

export const BOTTLENECK_COLOR: Record<BottleneckKind, string> = {
  gpu: 'var(--ok)',
  cpu: 'var(--warning)',
  mixed: 'var(--info)',
  limited: 'var(--info)',
  unknown: 'var(--unknown)',
};

export const PACING_LABEL: Record<PacingSeverity, string> = {
  ok: 'Ритм ровный',
  noticeable: 'Ритм заметно рваный',
  bad: 'Ритм рваный',
};

export const PACING_COLOR: Record<PacingSeverity, string> = {
  ok: 'var(--ok)',
  noticeable: 'var(--warning)',
  bad: 'var(--critical)',
};

export const NETWORK_LABEL: Record<NetworkSeverity, string> = {
  ok: 'Сеть ровная',
  noticeable: 'Сеть заметно дрожит',
  bad: 'Сеть нестабильна',
};

export const NETWORK_COLOR: Record<NetworkSeverity, string> = {
  ok: 'var(--ok)',
  noticeable: 'var(--warning)',
  bad: 'var(--critical)',
};

/**
 * Цвет улики несёт смысл: красное — кадр ждал снаружи, жёлтое — устройство
 * заняло его целиком, синее — обстоятельства вокруг.
 */
export const EVIDENCE_COLOR: Record<EvidenceKind, string> = {
  'gpu-work': 'var(--ok)',
  'cpu-work': 'var(--warning)',
  waiting: 'var(--critical)',
  'present-mode': 'var(--info)',
  dropped: 'var(--info)',
  'gpu-idle': 'var(--warning)',
  'vram-growth': 'var(--unknown)',
  throttling: 'var(--critical)',
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  better: 'var(--ok)',
  worse: 'var(--critical)',
  same: 'var(--muted)',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  better: 'лучше',
  worse: 'хуже',
  same: 'без изменений',
};
