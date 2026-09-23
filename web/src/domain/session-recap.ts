import type { Capture, EvidenceKind } from './models.ts';

const LABELS: Record<EvidenceKind, string> = {
  'background-process': 'всплески нагрузки других программ',
  'gpu-work': 'долгая работа видеокарты',
  'cpu-work': 'долгая работа процессора',
  waiting: 'ожидания',
  'present-mode': 'смена режима вывода',
  dropped: 'пропущенные кадры',
  'gpu-idle': 'простой видеокарты',
  'vram-growth': 'рост занятой видеопамяти',
  throttling: 'снижение частот',
};
export function sessionRecap(capture: Capture) {
  const hasFrames = capture.frameCount > 0 && capture.durationSeconds > 0;
  const top = [...capture.correlation.tally]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)[0];
  const recommendation = [...capture.recommendations]
    .filter((item) => item.prediction !== null)
    .sort((a, b) => Number(b.confidence === 'measured') - Number(a.confidence === 'measured'))[0];
  const observation = !hasFrames
    ? 'Недостаточно кадров для вывода.'
    : capture.stutterCount === 0
      ? 'Резких скачков времени кадра не обнаружено. Это не исключает низкий FPS или сетевые задержки.'
      : top
        ? `Чаще всего с рывками совпадали ${LABELS[top.kind]}: ${top.count} из ${capture.stutterCount}. Совпадение не доказывает причину.`
        : 'Для найденных рывков не обнаружено совпадений, которые объясняли бы их причину.';
  const next = !hasFrames
    ? 'Повторите запись с запущенной игрой.'
    : capture.stutterCount > 0 && top?.kind === 'background-process'
      ? 'Откройте подробный разбор и проверьте программы, отмеченные рядом с рывками. Закройте одну ненужную программу и повторите тот же участок игры.'
      : recommendation
        ? recommendation.title
        : capture.stutterCount > 0
          ? capture.sensorSampleCount === 0
            ? 'Повторите тот же участок игры с включённым сбором датчиков и сравните записи.'
            : 'Откройте подробный разбор самых длинных кадров, затем повторите тот же участок игры для сравнения.'
          : 'Сохраните запись как исходную для сравнения будущих изменений.';
  return {
    observation,
    next,
    expectation:
      hasFrames && recommendation && top?.kind !== 'background-process'
        ? recommendation.expect
        : null,
    limitations: [
      ...new Set([
        ...(capture.sensorSampleCount === 0
          ? ['Данные датчиков отсутствуют: нагрузку и температуры сопоставить нельзя.']
          : []),
        ...(capture.durationSeconds < 30
          ? ['Короткая запись: для устойчивого вывода нужен более длинный повторяемый участок.']
          : []),
        'Итог относится ко всей записи, включая меню и загрузки, если они в неё попали.',
      ]),
    ],
  };
}
