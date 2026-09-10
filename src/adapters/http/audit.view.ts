import type { AuditReport } from '../../domain/diagnostics/audit-report.ts';
import type { RuleCorroboration } from '../../domain/diagnostics/corroboration.ts';
import type { Finding } from '../../domain/diagnostics/finding.ts';
import type { Severity } from '../../domain/diagnostics/severity.ts';
import type { SystemSnapshot } from '../../domain/snapshot/system-snapshot.ts';
import { primaryGpu } from '../../domain/snapshot/system-snapshot.ts';

/**
 * Форма, в которой отчёт уезжает в интерфейс.
 *
 * Это не домен: здесь уже посчитаны сводки и разложены заголовки — всё, чего
 * интерфейсу иначе пришлось бы считать самому. Домен об этой структуре не знает.
 */
/** Что об этой находке говорит запись кадров. */
export interface CorroborationView {
  readonly confirmed: boolean;
  readonly detail: string;
}

export interface FindingView {
  readonly ruleId: string;
  readonly title: string;
  readonly severity: Severity;
  readonly summary: string;
  readonly observed: string;
  readonly expected: string;
  readonly impact: string;
  readonly remediation: readonly string[];
  /**
   * Сверка с записью. `null` — записей нет или связи для этого правила нет.
   *
   * Важность находки от неё не меняется: одна запись — это одна запись, и
   * «не проявилось сегодня» не то же самое, что «не проблема».
   */
  readonly corroboration: CorroborationView | null;
}

export interface MachineView {
  readonly name: string;
  readonly os: string;
  readonly cpu: string;
  readonly gpu: string;
  readonly displays: readonly string[];
  readonly games: readonly string[];
  readonly collectedAsAdmin: boolean;
  readonly capturedAt: string;
}

export interface AuditView {
  readonly machine: MachineView;
  readonly findings: readonly FindingView[];
  readonly counts: Readonly<Record<Severity, number>>;
  readonly collectionErrors: readonly string[];
}

const EMPTY_COUNTS: Record<Severity, number> = {
  critical: 0,
  warning: 0,
  unknown: 0,
  info: 0,
  ok: 0,
};

export function toAuditView(
  snapshot: SystemSnapshot,
  report: AuditReport,
  corroborations: readonly RuleCorroboration[] = [],
): AuditView {
  const byRule = new Map(corroborations.map((entry) => [entry.ruleId, entry]));

  return {
    machine: toMachineView(snapshot),
    findings: report.findings.map((finding) =>
      toFindingView(finding, byRule.get(finding.ruleId) ?? null),
    ),
    counts: countBySeverity(report.findings),
    collectionErrors: snapshot.collectionErrors,
  };
}

function toFindingView(
  finding: Finding,
  corroboration: RuleCorroboration | null,
): FindingView {
  return {
    ruleId: finding.ruleId,
    title: finding.title,
    severity: finding.severity,
    summary: finding.summary,
    observed: finding.observed,
    expected: finding.expected,
    impact: finding.impact,
    remediation: finding.remediation,
    corroboration:
      corroboration === null
        ? null
        : { confirmed: corroboration.confirmed, detail: corroboration.detail },
  };
}

function toMachineView(snapshot: SystemSnapshot): MachineView {
  const gpu = primaryGpu(snapshot);
  return {
    name: snapshot.machineName,
    os: `${snapshot.os.caption} (сборка ${snapshot.os.buildNumber})`,
    cpu: snapshot.cpu.name,
    gpu: gpu === undefined ? 'не определён' : gpu.name,
    displays: snapshot.displays.map(
      (display) =>
        `${display.adapterName} — ${display.horizontalResolution ?? '?'}×${
          display.verticalResolution ?? '?'
        } @ ${display.currentRefreshHz ?? '?'} Гц`,
    ),
    games: snapshot.games.map(
      (game) => `${game.name}${game.launchOptions === null ? '' : ` (${game.launchOptions})`}`,
    ),
    collectedAsAdmin: snapshot.collectedAsAdmin,
    capturedAt: snapshot.capturedAt,
  };
}

function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts = { ...EMPTY_COUNTS };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}
