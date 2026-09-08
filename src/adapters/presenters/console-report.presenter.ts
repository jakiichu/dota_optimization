import type { AuditReport } from '../../domain/diagnostics/audit-report.ts';
import type { Finding } from '../../domain/diagnostics/finding.ts';
import type { Severity } from '../../domain/diagnostics/severity.ts';
import type { SystemSnapshot } from '../../domain/snapshot/system-snapshot.ts';
import { primaryGpu } from '../../domain/snapshot/system-snapshot.ts';

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

const SEVERITY_STYLE: Record<Severity, { label: string; color: string }> = {
  critical: { label: 'КРИТИЧНО', color: '\u001b[31m' },
  warning: { label: 'ВНИМАНИЕ', color: '\u001b[33m' },
  unknown: { label: 'НЕ ПРОВЕРЕНО', color: '\u001b[35m' },
  info: { label: 'К СВЕДЕНИЮ', color: '\u001b[36m' },
  ok: { label: 'В ПОРЯДКЕ', color: '\u001b[32m' },
};

export interface ConsoleReportOptions {
  /** Показывать проверки со статусом `ok`. */
  readonly verbose: boolean;
  readonly color: boolean;
}

/**
 * Презентер собирает строку и ничего не печатает: вывод — это работа
 * composition root, а не слоя представления. Так отчёт можно проверить тестом.
 */
export function renderConsoleReport(
  snapshot: SystemSnapshot,
  report: AuditReport,
  options: ConsoleReportOptions,
): string {
  const paint = (text: string, code: string): string =>
    options.color ? `${code}${text}${RESET}` : text;

  const lines: string[] = [];
  lines.push(paint('Аудит конфигурации', BOLD));
  lines.push(paint(renderMachineLine(snapshot), DIM));
  if (!snapshot.collectedAsAdmin) {
    lines.push(
      paint('Запущено без прав администратора — часть проверок недоступна.', DIM),
    );
  }
  lines.push('');

  const shown = options.verbose
    ? report.findings
    : report.findings.filter((finding) => finding.severity !== 'ok');

  if (shown.length === 0) {
    lines.push('Проблем не найдено.');
  }

  for (const finding of shown) {
    lines.push(...renderFinding(finding, paint));
    lines.push('');
  }

  lines.push(paint(renderSummaryLine(report), DIM));

  if (snapshot.collectionErrors.length > 0) {
    lines.push('');
    lines.push(paint('Не удалось собрать:', DIM));
    for (const error of snapshot.collectionErrors) {
      lines.push(paint(`  · ${error}`, DIM));
    }
  }

  return lines.join('\n');
}

function renderMachineLine(snapshot: SystemSnapshot): string {
  const gpu = primaryGpu(snapshot);
  const parts = [
    snapshot.machineName,
    `${snapshot.os.caption} (сборка ${snapshot.os.buildNumber})`,
    snapshot.cpu.name,
    gpu === undefined ? 'GPU не определён' : gpu.name,
    snapshot.capturedAt,
  ];
  return parts.join(' · ');
}

function renderFinding(
  finding: Finding,
  paint: (text: string, code: string) => string,
): string[] {
  const style = SEVERITY_STYLE[finding.severity];
  const lines: string[] = [];

  lines.push(
    `${paint(`[${style.label}]`, style.color)} ${paint(finding.title, BOLD)} ${paint(
      finding.ruleId,
      DIM,
    )}`,
  );
  lines.push(`  ${finding.summary}`);
  lines.push(paint(`  сейчас:  ${finding.observed}`, DIM));
  if (finding.expected !== '') {
    lines.push(paint(`  должно:  ${finding.expected}`, DIM));
  }
  if (finding.impact !== '') {
    lines.push(`  почему:  ${finding.impact}`);
  }
  for (const step of finding.remediation) {
    lines.push(`    → ${step}`);
  }
  return lines;
}

function renderSummaryLine(report: AuditReport): string {
  const counts = new Map<Severity, number>();
  for (const finding of report.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  const order: Severity[] = ['critical', 'warning', 'unknown', 'info', 'ok'];
  const parts = order
    .filter((severity) => (counts.get(severity) ?? 0) > 0)
    .map((severity) => `${SEVERITY_STYLE[severity].label.toLowerCase()}: ${counts.get(severity)}`);
  return `Проверок: ${report.findings.length} · ${parts.join(' · ')}`;
}
