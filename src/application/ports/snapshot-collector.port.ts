import type { SystemSnapshot } from '../../domain/snapshot/system-snapshot.ts';

/**
 * Источник снимка системы.
 *
 * Реализаций как минимум три: живая машина, снимок из файла и подделка в
 * тестах. Сценарий не должен различать их — отсюда порт.
 */
export interface SnapshotCollector {
  collect(): Promise<SystemSnapshot>;
}
