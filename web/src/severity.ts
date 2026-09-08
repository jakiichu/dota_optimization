import type { Severity } from './api.ts';

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
export const DEFAULT_VISIBLE: readonly Severity[] = ['critical', 'warning', 'unknown', 'info'];
