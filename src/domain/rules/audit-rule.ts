import type { Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';

/**
 * Правило аудита — чистая функция от снимка к находке.
 *
 * Ни одно правило не читает систему само: весь ввод-вывод остаётся в
 * инфраструктуре, а правила остаются проверяемыми на выдуманных снимках.
 */
export interface AuditRule {
  readonly id: string;
  readonly title: string;
  /** `null` — правило неприменимо к этой машине (например, проверка ноутбука на ПК). */
  evaluate(snapshot: SystemSnapshot): Finding | null;
}
