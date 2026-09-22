import type {
  Capture,
  Evidence,
  EvidenceKind,
  Recommendation,
  RecommendationKind,
  Stutter,
} from './models.ts';

export interface StutterInspection {
  readonly stutter: Stutter;
  readonly evidence: readonly Evidence[];
  readonly primaryKind: EvidenceKind | null;
  /** Проверка, которую движок уже обосновал по всей записи. */
  readonly relatedRecommendation: Recommendation | null;
  readonly recommendationAnchor: string | null;
}

const RECOMMENDATION_BY_EVIDENCE: Partial<Record<EvidenceKind, RecommendationKind>> = {
  'gpu-work': 'gpu-relief',
  'vram-growth': 'gpu-relief',
  'cpu-work': 'cpu-relief',
  'gpu-idle': 'cpu-relief',
  'present-mode': 'present-mode',
  dropped: 'present-mode',
  waiting: 'frame-cap',
  throttling: 'not-config',
};

/** Самые длинные рывки вместе с их уликами, включая необъяснённые. */
export function inspectableStutters(capture: Capture): readonly StutterInspection[] {
  const evidence = new Map(
    capture.correlation.stutters.map((entry) => [entry.stutter.frameIndex, entry.evidence]),
  );
  const kinds = new Map(
    capture.series.stutterMarks.map((mark) => [mark.frameIndex, mark.kind]),
  );
  return [...capture.worstStutters]
    .sort((left, right) => right.frameTimeMs - left.frameTimeMs)
    .map((stutter) => {
      const foundEvidence = evidence.get(stutter.frameIndex) ?? [];
      const primaryKind = kinds.get(stutter.frameIndex) ?? null;
      const recommendationKind = relatedKind(primaryKind, foundEvidence);
      const recommendationIndex = recommendationKind === null
        ? -1
        : capture.recommendations.findIndex((item) => item.kind === recommendationKind);
      return {
        stutter,
        evidence: foundEvidence,
        primaryKind,
        relatedRecommendation: capture.recommendations[recommendationIndex] ?? null,
        recommendationAnchor: recommendationIndex < 0
          ? null
          : recommendationAnchor(recommendationIndex),
      };
    });
}

export function recommendationAnchor(index: number): string {
  return `recommendation-${index + 1}`;
}

function relatedKind(
  primary: EvidenceKind | null,
  evidence: readonly Evidence[],
): RecommendationKind | null {
  if (primary !== null) return RECOMMENDATION_BY_EVIDENCE[primary] ?? null;
  for (const item of evidence) {
    const kind = RECOMMENDATION_BY_EVIDENCE[item.kind];
    if (kind !== undefined) return kind;
  }
  return null;
}
