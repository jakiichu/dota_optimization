/**
 * Насколько находка влияет на кадры.
 *
 * `unknown` — отдельный уровень, а не разновидность `ok`: не сумев прочитать
 * настройку, инструмент обязан сказать «не проверил», а не «всё хорошо».
 */
export type Severity = 'critical' | 'warning' | 'info' | 'ok' | 'unknown';

const ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  unknown: 2,
  info: 3,
  ok: 4,
};

export function compareSeverity(a: Severity, b: Severity): number {
  return ORDER[a] - ORDER[b];
}

export function isActionable(severity: Severity): boolean {
  return severity === 'critical' || severity === 'warning';
}
