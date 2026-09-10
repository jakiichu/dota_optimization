import type {
  BottleneckKind,
  Confidence,
  CvarImpact,
  EvidenceKind,
  HypothesisOutcome,
  NetworkSeverity,
  NoteSeverity,
  PacingSeverity,
  Severity,
  Verdict,
} from './models.ts';

/**
 * Как называются и чем окрашиваются состояния предметной области.
 *
 * Здесь, а не в компонентах: одна и та же важность встречается на четырёх
 * экранах, и расходиться в названиях они не должны. Функций рендера тут нет —
 * только соответствия, поэтому слой остаётся чистым.
 */

export const SEVERITY_ORDER: readonly Severity[] = [
  'critical',
  'warning',
  'unknown',
  'info',
  'ok',
];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'критично',
  warning: 'внимание',
  unknown: 'не проверено',
  info: 'к сведению',
  ok: 'в порядке',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warning)',
  unknown: 'var(--unknown)',
  info: 'var(--info)',
  ok: 'var(--ok)',
};

/** По умолчанию прячем то, что и так в порядке: экран должен показывать работу. */
export const DEFAULT_VISIBLE_SEVERITIES: readonly Severity[] = [
  'critical',
  'warning',
  'unknown',
  'info',
];

export const BOTTLENECK_LABEL: Record<BottleneckKind, string> = {
  gpu: 'Упор в видеокарту',
  cpu: 'Упор в процессор',
  mixed: 'Ограничитель меняется',
  limited: 'Работает ограничитель кадров',
  unknown: 'Определить не удалось',
};

export const BOTTLENECK_COLOR: Record<BottleneckKind, string> = {
  gpu: 'var(--ok)',
  cpu: 'var(--warning)',
  mixed: 'var(--info)',
  limited: 'var(--info)',
  unknown: 'var(--unknown)',
};

export const PACING_LABEL: Record<PacingSeverity, string> = {
  ok: 'Ритм ровный',
  noticeable: 'Ритм заметно рваный',
  bad: 'Ритм рваный',
};

export const PACING_COLOR: Record<PacingSeverity, string> = {
  ok: 'var(--ok)',
  noticeable: 'var(--warning)',
  bad: 'var(--critical)',
};

export const NETWORK_LABEL: Record<NetworkSeverity, string> = {
  ok: 'Сеть ровная',
  noticeable: 'Сеть заметно дрожит',
  bad: 'Сеть нестабильна',
};

export const NETWORK_COLOR: Record<NetworkSeverity, string> = {
  ok: 'var(--ok)',
  noticeable: 'var(--warning)',
  bad: 'var(--critical)',
};

/**
 * Цвет улики несёт смысл: красное — кадр ждал снаружи, жёлтое — устройство
 * заняло его целиком, синее — обстоятельства вокруг.
 */
/**
 * Улика в двух словах — для легенды графика.
 *
 * Полные формулировки остаются в самих уликах: в легенде «Кадр целиком занят
 * работой GPU» не помещается, а смысл цвета передать надо.
 */
export const EVIDENCE_SHORT: Record<EvidenceKind, string> = {
  'gpu-work': 'GPU занял кадр',
  'cpu-work': 'CPU занял кадр',
  waiting: 'кадр ждал',
  'present-mode': 'сменился вывод',
  dropped: 'отброшены кадры',
  'gpu-idle': 'GPU простаивал',
  'vram-growth': 'росла видеопамять',
  throttling: 'троттлинг',
};

export const EVIDENCE_COLOR: Record<EvidenceKind, string> = {
  'gpu-work': 'var(--ok)',
  'cpu-work': 'var(--warning)',
  waiting: 'var(--critical)',
  'present-mode': 'var(--info)',
  dropped: 'var(--info)',
  'gpu-idle': 'var(--warning)',
  'vram-growth': 'var(--unknown)',
  throttling: 'var(--critical)',
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  better: 'var(--ok)',
  worse: 'var(--critical)',
  same: 'var(--muted)',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  better: 'лучше',
  worse: 'хуже',
  same: 'без изменений',
};

// --- конфиг игры ------------------------------------------------------------

export type ImpactGroup = CvarImpact | 'unknown';

/**
 * Порядок групп в редакторе конфига.
 *
 * Сначала то, что может стоить кадров, потом то, что меняет игру, и в самом
 * конце незнакомое. Незнакомое внизу не потому, что оно неважно, а потому что
 * сказать о нём нечего: человеку не с чем работать, кроме имени переменной.
 */
export const IMPACT_GROUP_ORDER: readonly ImpactGroup[] = [
  'cpu',
  'both',
  'gpu',
  'gameplay',
  'cosmetic',
  'none',
  'unknown',
];

/**
 * Заголовок группы отвечает на вопрос «кто делает эту работу».
 *
 * Не «Процессор», а «Это считает процессор»: одно слово в заголовке заставляет
 * человека гадать, при чём тут процессор — то ли эти настройки его грузят, то
 * ли разгружают, то ли требуют.
 */
export const IMPACT_GROUP_TITLE: Record<ImpactGroup, string> = {
  cpu: 'Это считает процессор',
  both: 'Это считает процессор и рисует видеокарта',
  gpu: 'Это рисует видеокарта',
  gameplay: 'Это меняет саму игру',
  cosmetic: 'Это только внешний вид',
  none: 'Это на скорость не влияет',
  unknown: 'Про эти мы ничего не знаем',
};

/**
 * Оговорка про замер — один раз над группой.
 *
 * Раньше она стояла в каждой из семидесяти строк («возможно, разгружает
 * процессор») и от повторения перестала читаться вовсе.
 */
export const IMPACT_GROUP_HINT: Record<ImpactGroup, string> = {
  cpu: 'Выключив их, вы снимете работу с процессора. Сколько именно кадров это ' +
    'даст на вашей машине — покажет только запись, таблица этого знать не может.',
  both: 'Выключив их, вы снимете работу и с процессора, и с видеокарты. ' +
    'Сколько это даст — покажет только запись.',
  gpu: 'Выключив их, вы снимете работу с видеокарты. Сколько именно кадров это ' +
    'даст на вашей машине — покажет только запись, таблица этого знать не может.',
  gameplay: 'Цвета, подсветка, управление. Скорость они не меняют — только то, ' +
    'что вы видите и как играете.',
  cosmetic: 'Кровь, останки, кольца под юнитами. На скорость влияет незаметно.',
  none: 'Эти строки не про производительность вовсе.',
  unknown: 'Имя переменной есть, а что она делает — мы не знаем. Придумывать не ' +
    'станем: поверив выдумке, вы оставите в конфиге вредное.',
};

export const IMPACT_COLOR: Record<ImpactGroup, string> = {
  cpu: 'var(--warning)',
  both: 'var(--info)',
  gpu: 'var(--ok)',
  gameplay: 'var(--info)',
  cosmetic: 'var(--muted)',
  none: 'var(--muted)',
  unknown: 'var(--unknown)',
};

export const NOTE_COLOR: Record<NoteSeverity, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

/**
 * Приговор гипотезе.
 *
 * «Не подтвердилась» и «опровергнута» — разные вещи, и сливать их нельзя.
 * Первое значит «правка не сделала ничего», второе — «сделала хуже», и
 * действия по ним тоже разные.
 */
export const OUTCOME_LABEL: Record<HypothesisOutcome, string> = {
  confirmed: 'Подтвердилась',
  refuted: 'Опровергнута',
  'no-change': 'Не подтвердилась',
  'not-comparable': 'Проверить нельзя',
  'not-measured': 'Проверять нечем',
};

export const OUTCOME_COLOR: Record<HypothesisOutcome, string> = {
  confirmed: 'var(--ok)',
  refuted: 'var(--critical)',
  'no-change': 'var(--warning)',
  'not-comparable': 'var(--unknown)',
  'not-measured': 'var(--unknown)',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  measured: 'видно прямо в записи',
  likely: 'следует из записи, но не прямо',
};
