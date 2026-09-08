import { buildReport, type AuditReport } from '../../domain/diagnostics/audit-report.ts';
import type { Finding } from '../../domain/diagnostics/finding.ts';
import type { AuditRule } from '../../domain/rules/audit-rule.ts';
import type { SystemSnapshot } from '../../domain/snapshot/system-snapshot.ts';
import type { SnapshotCollector } from '../ports/snapshot-collector.port.ts';

export interface ConfigurationAuditResult {
  readonly snapshot: SystemSnapshot;
  readonly report: AuditReport;
}

/**
 * Снять состояние системы и прогнать по нему все правила.
 *
 * Упавшее правило не должно ронять аудит: остальные проверки полезны сами по
 * себе, а поломку конкретного правила честнее показать как «не проверили».
 */
export class RunConfigurationAudit {
  readonly #collector: SnapshotCollector;
  readonly #rules: readonly AuditRule[];

  constructor(collector: SnapshotCollector, rules: readonly AuditRule[]) {
    this.#collector = collector;
    this.#rules = rules;
  }

  async execute(): Promise<ConfigurationAuditResult> {
    const snapshot = await this.#collector.collect();
    const findings: Finding[] = [];

    for (const rule of this.#rules) {
      findings.push(...evaluateSafely(rule, snapshot));
    }

    const report = buildReport(snapshot.capturedAt, snapshot.machineName, findings);
    return { snapshot, report };
  }
}

function evaluateSafely(rule: AuditRule, snapshot: SystemSnapshot): Finding[] {
  try {
    const finding = rule.evaluate(snapshot);
    return finding === null ? [] : [finding];
  } catch (error) {
    return [
      {
        ruleId: rule.id,
        title: rule.title,
        severity: 'unknown',
        summary: 'Правило завершилось с ошибкой.',
        observed: error instanceof Error ? error.message : String(error),
        expected: '',
        impact: '',
        remediation: [],
      },
    ];
  }
}
