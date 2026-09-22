import { compareSessions, DECIDING_METRICS, type MetricId, type SessionComparison, type SessionSummary } from './session-comparison.ts';

export interface RepeatedMetric {
  readonly id: MetricId;
  readonly label: string;
  readonly unit: string;
  readonly before: { readonly min: number; readonly median: number; readonly max: number };
  readonly after: { readonly min: number; readonly median: number; readonly max: number };
  readonly direction: 'better' | 'worse' | 'overlap';
}

export interface RepeatedComparison {
  readonly status: 'better' | 'worse' | 'mixed' | 'inconclusive' | 'not-comparable';
  readonly summary: string;
  readonly pairs: readonly SessionComparison[];
  readonly metrics: readonly RepeatedMetric[];
  readonly caveats: readonly string[];
}

/** Не объединяем кадры: каждый прогон остаётся независимым наблюдением. */
export function compareRepeatedSessions(
  before: readonly SessionSummary[],
  after: readonly SessionSummary[],
): RepeatedComparison {
  validateRepeatedIds(before.map((s) => s.id), after.map((s) => s.id));
  const first = before[0]!;
  const pairs = before.map((session, index) => compareSessions(session, after[index]!));
  const reasons: string[] = [];
  const all = [...before, ...after];
  if (all.some((s) => s.scene.kind !== 'replay' || s.scene.startTick === null ||
    s.scene.replayFile === null || !compareSessions(first, s).comparable)) {
    reasons.push('Для серии нужен один и тот же повтор с одной известной начальной точки во всех записях.');
  }
  if (all.some((s) => s.application.toLowerCase() !== first.application.toLowerCase())) {
    reasons.push('В серии выбраны разные приложения.');
  }
  const durations = all.map((s) => s.durationSeconds);
  if (Math.min(...durations) <= 0 || Math.max(...durations) / Math.min(...durations) > 1.1) {
    reasons.push('Длительности прогонов должны отличаться не больше чем на 10%.');
  }
  for (const group of [before, after]) {
    if (group.slice(1).some((s) => compareSessions(group[0]!, s).changes.length > 0)) {
      reasons.push('Внутри группы менялась конфигурация машины. Соберите группу с одинаковыми настройками.');
      break;
    }
  }
  const metrics: RepeatedMetric[] = [];
  for (const id of DECIDING_METRICS) {
    const deltas = pairs.map((pair) => pair.metrics.find((metric) => metric.id === id));
    if (deltas.some((metric) => metric === undefined)) continue;
    const available = deltas.filter((metric) => metric !== undefined);
    const metric = available[0]!;
    const from = range(available.map((m) => m.before));
    const to = range(available.map((m) => m.after));
    // Направление должно повториться в каждой паре и разделять наблюдавшиеся
    // диапазоны. Это описательная проверка, не доверительный интервал.
    const better = available.every((m) => m.verdict === 'better') &&
      (metric.lowerIsBetter ? to.max < from.min : to.min > from.max);
    const worse = available.every((m) => m.verdict === 'worse') &&
      (metric.lowerIsBetter ? to.min > from.max : to.max < from.min);
    metrics.push({ id, label: metric.label, unit: metric.unit, before: from, after: to,
      direction: better ? 'better' : worse ? 'worse' : 'overlap' });
  }
  const better = metrics.some((m) => m.direction === 'better');
  const worse = metrics.some((m) => m.direction === 'worse');
  // Разнонаправленный результат даже одной пары не прячем за медианой серии.
  const anyBetter = pairs.some((p) => p.metrics.some((m) => DECIDING_METRICS.has(m.id) && m.verdict === 'better'));
  const anyWorse = pairs.some((p) => p.metrics.some((m) => DECIDING_METRICS.has(m.id) && m.verdict === 'worse'));
  const status = reasons.length > 0 ? 'not-comparable' : anyBetter && anyWorse ? 'mixed' :
    better ? 'better' : worse ? 'worse' : 'inconclusive';
  const summaries: Record<RepeatedComparison['status'], string> = {
    better: 'Улучшение повторилось во всех парах; диапазоны хотя бы одной основной метрики не пересекаются.',
    worse: 'Ухудшение повторилось во всех парах; диапазоны хотя бы одной основной метрики не пересекаются.',
    mixed: 'Смешанный эффект: среди основных метрик или прогонов есть и улучшения, и ухудшения.',
    inconclusive: 'Устойчивый эффект не обнаружен: изменения малы, повторяются не во всех парах или диапазоны пересекаются.',
    'not-comparable': 'Условия серии различаются — делать общий вывод нельзя.',
  };
  const caveats = [...reasons,
    'Диапазоны показывают минимум и максимум среди выбранных прогонов. Это не доверительные интервалы и не доказательство причины изменений.',
    'Одинаковая начальная точка указана в записи; фактический момент старта и камеру нужно выдерживать при каждом прогоне.',
  ];
  if (all.some((s) => s.passport.settings.length === 0)) caveats.push('В части записей нет сохранённых настроек машины: проверить постоянство конфигурации полностью нельзя.');
  if (all.some((s) => s.programs === null)) caveats.push('В части записей нет данных о фоновых программах.');
  if (all.some((s) => {
    const diff = compareSessions(first, s);
    return diff.programsAppeared.length > 0 || diff.programsGone.length > 0;
  })) caveats.push('Набор фоновых программ менялся: он тоже мог повлиять на результат.');
  if (pairs.some((p) => p.changes.length !== 1)) caveats.push('Между группами не везде зафиксировано ровно одно изменение. Связать эффект с одной настройкой нельзя.');
  return { status, summary: summaries[status], pairs, metrics, caveats };
}

export function validateRepeatedIds(before: readonly string[], after: readonly string[]): void {
  if (before.length < 3 || before.length > 5 || before.length !== after.length) {
    throw new Error('Выберите от 3 до 5 записей в каждой группе, поровну до и после.');
  }
  const ids = [...before, ...after];
  if (ids.some((id) => id.trim() === '') || new Set(ids).size !== ids.length) {
    throw new Error('Каждая запись должна использоваться в серии только один раз.');
  }
}

function range(values: number[]): RepeatedMetric['before'] {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { min: sorted[0]!, max: sorted[sorted.length - 1]!,
    median: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]! };
}
