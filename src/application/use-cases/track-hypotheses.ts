import { compareScenes, UNKNOWN_SCENE } from '../../domain/telemetry/capture-scene.ts';
import {
  checkHypothesis,
  unexpectedChanges,
  type HypothesisCheck,
} from '../../domain/gameconfig/hypothesis.ts';
import type { PassportChange } from '../../domain/snapshot/machine-passport.ts';
import type {
  Recommendation,
  RecommendationKind,
} from '../../domain/gameconfig/recommendations.ts';
import {
  compareSessions,
  type SessionComparison,
  type SessionSummary,
} from '../../domain/telemetry/session-comparison.ts';
import type { HypothesisStore } from '../ports/hypothesis-store.port.ts';
import type { SessionStore } from '../ports/session-store.port.ts';

/**
 * Гипотезы: завести, дождаться второй записи, вынести приговор.
 *
 * Вердикт нигде не хранится — он выводится при каждом чтении из текущих сводок.
 * Правило то же, что у метрик: сохранив приговор, мы законсервировали бы его
 * вместе с версией кода, и новый детектор судил бы старые гипотезы по старому.
 */

export interface HypothesisCandidate {
  readonly id: string;
  /** Можно ли сравнивать: та же сцена или нет. */
  readonly comparable: boolean;
}

export interface HypothesisView {
  readonly id: string;
  readonly createdAt: string;
  readonly recommendation: Recommendation;
  /** `null`, если запись «до» удалили. */
  readonly before: SessionSummary | null;
  readonly after: SessionSummary | null;
  readonly comparison: SessionComparison | null;
  readonly check: HypothesisCheck | null;
  /**
   * Что поменялось между записями сверх обещанного рекомендацией.
   *
   * Не пусто — опыт был нечистым, и вывод может быть не про ту настройку.
   */
  readonly unexpected: readonly PassportChange[];
  /** Записи, которые годятся на роль «после». Пусто у проверенных. */
  readonly candidates: readonly HypothesisCandidate[];
}

/** Откуда берутся рекомендации по записи. */
export type RecommendationsFor = (
  sessionId: string,
) => Promise<readonly Recommendation[]>;

export class TrackHypotheses {
  readonly #store: HypothesisStore;
  readonly #sessions: SessionStore;
  readonly #recommendationsFor: RecommendationsFor;

  constructor(
    store: HypothesisStore,
    sessions: SessionStore,
    recommendationsFor: RecommendationsFor,
  ) {
    this.#store = store;
    this.#sessions = sessions;
    this.#recommendationsFor = recommendationsFor;
  }

  /**
   * Заводит гипотезу по рекомендации из записи.
   *
   * Клиент называет только запись и вид рекомендации — саму рекомендацию мы
   * считаем заново. Принять её текстом из запроса значило бы позволить
   * проверять предсказание, которого инструмент не делал.
   */
  async record(sessionId: string, kind: RecommendationKind): Promise<HypothesisView> {
    const recommendations = await this.#recommendationsFor(sessionId);
    const found = recommendations.find((entry) => entry.kind === kind);

    if (found === undefined) {
      throw new Error(`В записи ${sessionId} нет такой рекомендации.`);
    }
    if (found.prediction === null) {
      throw new Error(
        `«${found.title}» проверить нечем: эта рекомендация не обещает измеримого ` +
          'изменения, потому что менять по ней нечего.',
      );
    }

    const saved = await this.#store.save(found, sessionId);
    return this.#read(saved.id);
  }

  async settle(id: string, afterSessionId: string): Promise<HypothesisView> {
    await this.#store.settle(id, afterSessionId);
    return this.#read(id);
  }

  forget(id: string): Promise<void> {
    return this.#store.forget(id);
  }

  async list(): Promise<readonly HypothesisView[]> {
    const [stored, sessions] = await Promise.all([
      this.#store.list(),
      this.#sessions.list(),
    ]);
    const byId = new Map(sessions.map((session) => [session.id, session]));

    return stored.map((entry) => {
      const before = byId.get(entry.beforeSessionId) ?? null;
      const after =
        entry.afterSessionId === null ? null : (byId.get(entry.afterSessionId) ?? null);

      const comparison = before !== null && after !== null ? compareSessions(before, after) : null;
      const prediction = entry.recommendation.prediction;

      return {
        id: entry.id,
        createdAt: entry.createdAt,
        recommendation: entry.recommendation,
        before,
        after,
        comparison,
        check:
          comparison === null || prediction === null
            ? null
            : checkHypothesis(prediction, comparison),
        unexpected:
          comparison === null
            ? []
            : unexpectedChanges(
                entry.recommendation.changes.map((change) => change.cvar),
                comparison.changes,
              ),
        candidates: after === null ? candidatesFor(before, sessions) : [],
      };
    });
  }

  /** Перечитывает гипотезу целиком: вердикт считается только при чтении. */
  async #read(id: string): Promise<HypothesisView> {
    const found = (await this.list()).find((view) => view.id === id);
    if (found === undefined) {
      throw new Error(`Гипотеза ${id} не читается после записи.`);
    }
    return found;
  }
}

/**
 * Записи, годные на роль «после»: сделанные позже той, из которой гипотеза.
 *
 * Несравнимые по сцене не прячем, а помечаем. Спрятать значило бы оставить
 * человека с пустым списком и без объяснения, почему его записи не подходят.
 */
function candidatesFor(
  before: SessionSummary | null,
  sessions: readonly SessionSummary[],
): readonly HypothesisCandidate[] {
  if (before === null) return [];

  return sessions
    .filter((session) => session.id !== before.id && session.capturedAt > before.capturedAt)
    .map((session) => ({
      id: session.id,
      comparable: compareScenes(
        before.scene ?? UNKNOWN_SCENE,
        session.scene ?? UNKNOWN_SCENE,
      ).comparable,
    }));
}
