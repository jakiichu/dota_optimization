import type { Severity } from './severity.ts';

/**
 * Результат одной проверки.
 *
 * `observed` и `expected` держим текстом рядом с выводом, чтобы пользователь
 * мог перепроверить нас руками: диагностический инструмент, которому нельзя
 * не поверить на слово, бесполезен.
 */
export interface Finding {
  readonly ruleId: string;
  readonly title: string;
  readonly severity: Severity;
  /** Что именно нашли — одна фраза. */
  readonly summary: string;
  /** Фактическое значение в системе. */
  readonly observed: string;
  /** Значение, которое мы считаем правильным. */
  readonly expected: string;
  /** Почему это стоит кадров. Без этого находка — просто придирка. */
  readonly impact: string;
  /** Конкретные шаги; пусто, если чинить нечего. */
  readonly remediation: readonly string[];
}

export function ok(
  ruleId: string,
  title: string,
  observed: string,
  summary: string,
): Finding {
  return {
    ruleId,
    title,
    severity: 'ok',
    summary,
    observed,
    // Для успешной проверки «должно быть» повторяло бы «сейчас» — это шум.
    expected: '',
    impact: '',
    remediation: [],
  };
}

export function unknown(
  ruleId: string,
  title: string,
  reason: string,
): Finding {
  return {
    ruleId,
    title,
    severity: 'unknown',
    summary: 'Не удалось проверить.',
    observed: reason,
    expected: '',
    impact: '',
    remediation: [],
  };
}
