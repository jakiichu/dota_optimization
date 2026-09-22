import type {ConfigSetting, Hypothesis, SessionSummary} from './models.ts';

export type ExperimentStep = 'missing-baseline' | 'config' | 'capture' | 'compare' | 'done';

/** Сохранённое значение не доказывает, что запущенная игра его применила. */
export function experimentProgress(
    hypothesis: Hypothesis,
    settings: readonly Pick<ConfigSetting, 'name' | 'value'>[] | undefined,
    sessions: readonly SessionSummary[],
): { readonly step: ExperimentStep; readonly saved: boolean; readonly candidates: readonly string[] } {
    const values = new Map(settings?.map((setting) => [setting.name.toLowerCase(), setting.value.trim()]));
    const saved = settings !== undefined && hypothesis.recommendation.changes.length > 0 &&
        hypothesis.recommendation.changes.every((change) => values.get(change.cvar.toLowerCase()) === change.value.trim());
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const candidates = hypothesis.candidates.filter((candidate) => {
        const session = byId.get(candidate.id);
        return candidate.comparable && session !== undefined && session.capturedAt > hypothesis.createdAt;
    }).map((candidate) => candidate.id);
    const step = hypothesis.before === null ? 'missing-baseline' : hypothesis.check !== null ? 'done' :
        candidates.length > 0 ? 'compare' : saved ? 'capture' : 'config';
    return {step, saved, candidates};
}
