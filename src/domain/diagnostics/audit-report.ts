import type { Finding } from './finding.ts';
import { compareSeverity, isActionable } from './severity.ts';

export interface AuditReport {
  readonly capturedAt: string;
  readonly machine: string;
  /** Отсортированы по убыванию важности. */
  readonly findings: readonly Finding[];
}

export function buildReport(
  capturedAt: string,
  machine: string,
  findings: readonly Finding[],
): AuditReport {
  const sorted = [...findings].sort(
    (a, b) => compareSeverity(a.severity, b.severity) || a.ruleId.localeCompare(b.ruleId),
  );
  return { capturedAt, machine, findings: sorted };
}

export function actionableFindings(report: AuditReport): readonly Finding[] {
  return report.findings.filter((finding) => isActionable(finding.severity));
}
