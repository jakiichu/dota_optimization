import type { Recommendation } from '../../domain/gameconfig/recommendations.ts';

/**
 * Хранилище гипотез.
 *
 * Гипотеза переживает перезапуск приложения намеренно: между записью «до» и
 * записью «после» человек закрывает игру, правит конфиг, иногда перезагружает
 * машину. Гипотеза, живущая в памяти сервера, до проверки бы не дожила — а
 * непроверенная гипотеза ничем не лучше совета из интернета.
 *
 * Хранится сырое: сама рекомендация и два идентификатора записей. Вердикт
 * выводится при чтении — как и метрики. Иначе новый детектор считал бы
 * по-новому, а гипотеза помнила бы старый приговор.
 */

export interface StoredHypothesis {
  readonly id: string;
  readonly createdAt: string;
  /** Рекомендация целиком: она и есть предсказание, которое проверяем. */
  readonly recommendation: Recommendation;
  readonly beforeSessionId: string;
  /** Запись «после». `null` — гипотеза ещё ждёт проверки. */
  readonly afterSessionId: string | null;
}

export interface HypothesisStore {
  save(recommendation: Recommendation, beforeSessionId: string): Promise<StoredHypothesis>;
  /** Свежие первыми. */
  list(): Promise<readonly StoredHypothesis[]>;
  settle(id: string, afterSessionId: string): Promise<StoredHypothesis>;
  forget(id: string): Promise<void>;
}
