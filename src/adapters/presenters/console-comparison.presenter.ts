import type {
  MetricDelta,
  SessionComparison,
  Verdict,
} from '../../domain/telemetry/session-comparison.ts';

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

const VERDICT_COLOR: Record<Verdict, string> = {
  better: '\u001b[32m',
  worse: '\u001b[31m',
  same: '\u001b[2m',
};

const VERDICT_LABEL: Record<Verdict, string> = {
  better: 'лучше',
  worse: 'хуже',
  same: 'без изменений',
};

const LABEL_WIDTH = 22;
const VALUE_WIDTH = 12;

export interface ConsoleComparisonOptions {
  readonly color: boolean;
}

export function renderComparison(
  comparison: SessionComparison,
  options: ConsoleComparisonOptions,
): string {
  const paint = (text: string, code: string): string =>
    options.color ? `${code}${text}${RESET}` : text;

  const lines: string[] = [];
  lines.push(paint('Сравнение записей', BOLD));
  lines.push(paint(`  до:    ${comparison.before.label}`, DIM));
  lines.push(paint(`  после: ${comparison.after.label}`, DIM));
  lines.push('');

  lines.push(paint(comparison.summary, VERDICT_COLOR[comparison.verdict]));
  if (comparison.bottleneckChanged) {
    lines.push(
      `Узкое место сменилось: ${comparison.before.bottleneck} → ${comparison.after.bottleneck}`,
    );
  }
  lines.push('');

  for (const metric of comparison.metrics) {
    lines.push(renderMetric(metric, paint));
  }
  lines.push('');

  // Оговорки не прячем: сравнение несопоставимых записей выглядит убедительнее,
  // чем оно есть, и человек примет решение по числам, которые ничего не значат.
  lines.push(paint('Насколько этому можно верить:', BOLD));
  for (const caveat of comparison.caveats) {
    lines.push(paint(`  · ${caveat}`, DIM));
  }

  return lines.join('\n');
}

function renderMetric(
  metric: MetricDelta,
  paint: (text: string, code: string) => string,
): string {
  const unit = metric.unit === '' ? '' : ` ${metric.unit}`;
  const before = `${metric.before.toFixed(1)}${unit}`.padStart(VALUE_WIDTH);
  const after = `${metric.after.toFixed(1)}${unit}`.padStart(VALUE_WIDTH);
  const sign = metric.delta > 0 ? '+' : '';
  const change = `${sign}${metric.delta.toFixed(1)}${unit}`.padStart(VALUE_WIDTH);

  return (
    `  ${metric.label.padEnd(LABEL_WIDTH)}${before} →${after}  ${change}  ` +
    paint(VERDICT_LABEL[metric.verdict], VERDICT_COLOR[metric.verdict])
  );
}
