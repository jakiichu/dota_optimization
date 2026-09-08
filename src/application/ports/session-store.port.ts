import type { SessionSummary } from '../../domain/telemetry/session-comparison.ts';
import type { FrameSessionResult } from '../use-cases/capture-frame-session.ts';

/** Запись вместе с тем, что о ней нужно знать в списке. */
export interface StoredSession {
  readonly summary: SessionSummary;
  readonly result: FrameSessionResult;
}

/**
 * Хранилище записей.
 *
 * Записи надо переживать перезапуск: сравнение «до и после» по определению
 * разделено перезагрузкой — половина советов инструмента её и требует.
 */
export interface SessionStore {
  save(label: string, result: FrameSessionResult): Promise<SessionSummary>;
  /** Список сводок, свежие первыми. Полные записи не читаются: они большие. */
  list(): Promise<readonly SessionSummary[]>;
  load(id: string): Promise<StoredSession>;
}
