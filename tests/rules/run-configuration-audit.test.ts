import { describe, expect, it } from 'vitest';
import type { SnapshotCollector } from '../../src/application/ports/snapshot-collector.port.ts';
import { RunConfigurationAudit } from '../../src/application/use-cases/run-configuration-audit.ts';
import type { AuditRule } from '../../src/domain/rules/audit-rule.ts';
import { allAuditRules } from '../../src/domain/rules/rule-registry.ts';
import type { SystemSnapshot } from '../../src/domain/snapshot/system-snapshot.ts';
import { snapshotWith } from '../support/snapshot-builder.ts';

class StubCollector implements SnapshotCollector {
  readonly #snapshot: SystemSnapshot;

  constructor(snapshot: SystemSnapshot) {
    this.#snapshot = snapshot;
  }

  collect(): Promise<SystemSnapshot> {
    return Promise.resolve(this.#snapshot);
  }
}

const explodingRule: AuditRule = {
  id: 'test.explodes',
  title: 'Правило, которое падает',
  evaluate() {
    throw new Error('нет такого ключа');
  },
};

describe('RunConfigurationAudit', () => {
  it('не роняет аудит из-за одного упавшего правила', async () => {
    const audit = new RunConfigurationAudit(new StubCollector(snapshotWith({})), [
      explodingRule,
      ...allAuditRules,
    ]);

    const { report } = await audit.execute();

    const crashed = report.findings.find((finding) => finding.ruleId === 'test.explodes');
    expect(crashed?.severity).toBe('unknown');
    expect(crashed?.observed).toBe('нет такого ключа');
    expect(report.findings.length).toBeGreaterThan(1);
  });

  it('ставит самое важное в начало отчёта', async () => {
    const snapshot = snapshotWith({
      displays: [
        {
          adapterName: 'GPU',
          horizontalResolution: 1920,
          verticalResolution: 1080,
          currentRefreshHz: 60,
          maxRefreshHz: 144,
        },
      ],
    });

    const { report } = await new RunConfigurationAudit(
      new StubCollector(snapshot),
      allAuditRules,
    ).execute();

    expect(report.findings[0]?.severity).toBe('critical');
  });
});
