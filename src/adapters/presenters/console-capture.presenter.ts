import type { Bottleneck, FrameStatistics } from '../../domain/telemetry/frame-metrics.ts';
import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';
import type { Recommendation } from '../../domain/gameconfig/recommendations.ts';
import type { CpuLoadProfile } from '../../domain/telemetry/cpu-load.ts';
import type { NetworkQuality } from '../../domain/telemetry/network-quality.ts';
import type { CorrelationReport } from '../../domain/telemetry/stutter-correlation.ts';

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

const BOTTLENECK_LABEL: Record<Bottleneck['kind'], string> = {
  gpu: 'Упор в видеокарту',
  cpu: 'Упор в процессор',
  mixed: 'Ограничитель меняется',
  limited: 'Работает ограничитель кадров',
  unknown: 'Определить не удалось',
};

/** Сколько худших статтеров показывать: остальные видны в общем счёте. */
const WORST_STUTTERS_SHOWN = 5;

export interface ConsoleCaptureOptions {
  readonly color: boolean;
}

export function renderCaptureReport(
  capture: FrameCapture,
  statistics: FrameStatistics,
  correlation: CorrelationReport,
  network: NetworkQuality,
  cpuLoad: CpuLoadProfile,
  recommendations: readonly Recommendation[],
  options: ConsoleCaptureOptions,
): string {
  const paint = (text: string, code: string): string =>
    options.color ? `${code}${text}${RESET}` : text;

  const lines: string[] = [];
  lines.push(paint(`Запись кадров: ${capture.applicationName}`, BOLD));
  lines.push(
    paint(
      `${statistics.frameCount} кадров за ${statistics.durationSeconds.toFixed(1)} с`,
      DIM,
    ),
  );
  lines.push('');

  if (statistics.frameCount === 0) {
    lines.push('Кадров не записано — игра не была запущена или не рисовала в это время.');
    return lines.join('\n');
  }

  lines.push(paint('Время кадра', BOLD));
  lines.push(`  средний FPS:  ${statistics.averageFps.toFixed(1)}`);
  lines.push(`  медиана:      ${ms(statistics.frameTime.p50)}`);
  lines.push(`  p95:          ${ms(statistics.frameTime.p95)}`);
  // p99 и p99.9 — это и есть «одно- и однодесятипроцентные просадки»,
  // посчитанные по времени кадра, а не по мгновенному FPS.
  lines.push(`  p99:          ${ms(statistics.frameTime.p99)}`);
  lines.push(`  p99.9:        ${ms(statistics.frameTime.p999)}`);
  if (statistics.inputLatency !== null) {
    lines.push(`  инпут-лаг p50: ${ms(statistics.inputLatency.p50)}`);
    lines.push(`  инпут-лаг p99: ${ms(statistics.inputLatency.p99)}`);
  }
  lines.push('');

  lines.push(paint('Ритм кадров', BOLD));
  lines.push(`  ${statistics.pacing.summary}`);
  for (const entry of statistics.pacing.multiples) {
    lines.push(
      paint(
        `  ×${entry.multiple}: ${entry.frameCount} кадров, ` +
          `${entry.secondsSpent.toFixed(1)} с`,
        DIM,
      ),
    );
  }
  lines.push('');

  lines.push(paint('Статтеры', BOLD));
  lines.push(
    `  всего ${statistics.stutters.length} ` +
      `(${statistics.stuttersPerMinute.toFixed(1)} в минуту)`,
  );
  for (const stutter of worstStutters(statistics)) {
    lines.push(
      paint(
        `  ${stutter.atSeconds.toFixed(1)} с: ${ms(stutter.frameTimeMs)} ` +
          `при норме ${ms(stutter.baselineMs)} (×${stutter.ratio.toFixed(1)})`,
        DIM,
      ),
    );
  }
  lines.push('');

  lines.push(paint('Во что упёрлись', BOLD));
  lines.push(`  ${BOTTLENECK_LABEL[statistics.bottleneck.kind]}`);
  lines.push(paint(`  ${statistics.bottleneck.explanation}`, DIM));
  lines.push('');

  lines.push(paint('С чем совпали статтеры', BOLD));
  if (correlation.tally.length === 0) {
    lines.push('  Ни одной улики не нашлось.');
  }
  for (const cause of correlation.tally) {
    lines.push(`  ${cause.count} из ${statistics.stutters.length}: ${cause.label}`);
  }
  if (correlation.unexplained > 0) {
    lines.push(paint(`  без объяснения: ${correlation.unexplained}`, DIM));
  }
  // Отсутствие улик из-за нехватки данных и отсутствие улик как факт — разные
  // вещи, и путать их нельзя.
  for (const limitation of correlation.limitations) {
    lines.push(paint(`  · ${limitation}`, DIM));
  }

  // Процессор рядом с узким местом: «упор в процессор» без этого не говорит,
  // что делать — добавлять ядер или искать, почему он сбрасывает частоты.
  if (cpuLoad.measured) {
    lines.push('');
    lines.push(paint('Процессор', BOLD));
    lines.push(`  ${cpuLoad.summary}`);
  }

  // Сеть отдельным разделом, а не среди улик по кадрам: она не удлиняет кадр,
  // но даёт на экране такой же рывок. Смешав их, мы бы предложили чинить
  // графику там, где виноват канал.
  if (network.measured) {
    lines.push('');
    lines.push(paint('Сеть', BOLD));
    lines.push(`  ${network.summary}`);
    for (const target of network.targets) {
      const median = target.medianMs === null ? '—' : `${target.medianMs.toFixed(0)} мс`;
      const jitter = target.jitterMs === null ? '—' : `${target.jitterMs.toFixed(1)} мс`;
      lines.push(
        paint(
          `  ${target.label} (${target.target}): ${median}, дрожание ${jitter}, ` +
            `потери ${(target.lossShare * 100).toFixed(1)}%`,
          DIM,
        ),
      );
    }
  }

  // Рекомендации в конце: сначала числа, потом выводы из них. Обратный порядок
  // читается как советы, к которым для солидности приложили графики.
  if (recommendations.length > 0) {
    lines.push('');
    lines.push(paint('Что попробовать', BOLD));
    for (const item of recommendations) {
      lines.push(`  ${item.title}`);
      lines.push(paint(`    повод:   ${item.evidence}`, DIM));
      for (const change of item.changes) {
        lines.push(`    ${change.cvar} ${change.value} — ${change.why}`);
      }
      lines.push(paint(`    ожидаем: ${item.expect}`, DIM));
      if (item.risk !== '') {
        lines.push(paint(`    цена:    ${item.risk}`, DIM));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function worstStutters(statistics: FrameStatistics): FrameStatistics['stutters'] {
  return [...statistics.stutters]
    .sort((left, right) => right.frameTimeMs - left.frameTimeMs)
    .slice(0, WORST_STUTTERS_SHOWN);
}

function ms(value: number): string {
  return `${value.toFixed(1)} мс`;
}
