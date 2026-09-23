import { describe, expect, it } from 'vitest';
import type { Capture, Stutter } from '../../web/src/domain/models.ts';
import { inspectableStutters } from '../../web/src/domain/stutter-inspection.ts';
import { reportCapture } from '../support/report-builder.ts';

function stutter(frameIndex: number, frameTimeMs: number): Stutter {
  return {
    frameIndex,
    atSeconds: frameIndex / 10,
    frameTimeMs,
    baselineMs: 10,
    ratio: frameTimeMs / 10,
  };
}

describe('разбор отдельного рывка', () => {
  it('сортирует худшие рывки и не скрывает необъяснённые', () => {
    const source = reportCapture();
    const smaller = stutter(12, 50);
    const worse = stutter(91, 120);
    const capture: Capture = {
      ...source,
      worstStutters: [smaller, worse],
      correlation: {
        ...source.correlation,
        stutters: [{ stutter: smaller, evidence: [] }],
      },
      series: {
        ...source.series,
        stutterMarks: [],
      },
    };

    const result = inspectableStutters(capture);

    expect(result.map((entry) => entry.stutter.frameIndex)).toEqual([91, 12]);
    expect(result[0]?.evidence).toEqual([]);
  });

  it('связывает улику и цвет с номером кадра, а не порядком списков', () => {
    const source = reportCapture();
    const first = stutter(4, 60);
    const second = stutter(30, 90);
    const capture: Capture = {
      ...source,
      worstStutters: [first, second],
      correlation: {
        ...source.correlation,
        stutters: [
          {
            stutter: second,
            evidence: [{ kind: 'gpu-work', detail: 'GPU занял почти весь кадр' }],
          },
          { stutter: first, evidence: [{ kind: 'waiting', detail: 'кадр ждал вне CPU и GPU' }] },
        ],
      },
      series: {
        ...source.series,
        stutterMarks: [
          {
            index: 0,
            frameIndex: first.frameIndex,
            atSeconds: first.atSeconds,
            frameTimeMs: first.frameTimeMs,
            kind: 'waiting',
            evidence: [],
          },
          {
            index: 1,
            frameIndex: second.frameIndex,
            atSeconds: second.atSeconds,
            frameTimeMs: second.frameTimeMs,
            kind: 'gpu-work',
            evidence: [],
          },
        ],
      },
    };

    const result = inspectableStutters(capture);

    expect(result[0]).toMatchObject({
      stutter: { frameIndex: 30 },
      primaryKind: 'gpu-work',
      evidence: [{ kind: 'gpu-work' }],
    });
    expect(result[1]).toMatchObject({
      stutter: { frameIndex: 4 },
      primaryKind: 'waiting',
      evidence: [{ kind: 'waiting' }],
    });
  });

  it('связывает рывок только с рекомендацией, рассчитанной по всей записи', () => {
    const source = reportCapture();
    const event = stutter(18, 85);
    const gpuRecommendation = {
      kind: 'gpu-relief' as const,
      title: 'Снизить нагрузку на видеокарту',
      evidence: 'Видеокарта занимала почти весь кадр.',
      changes: [],
      expect: 'В повторной записи длительность рывков должна уменьшиться.',
      prediction: null,
      risk: '',
      confidence: 'measured' as const,
    };
    const capture: Capture = {
      ...source,
      worstStutters: [event],
      recommendations: [gpuRecommendation],
      correlation: {
        ...source.correlation,
        stutters: [{ stutter: event, evidence: [{ kind: 'gpu-work', detail: 'GPU занял кадр' }] }],
      },
      series: {
        ...source.series,
        stutterMarks: [
          {
            index: 0,
            frameIndex: event.frameIndex,
            atSeconds: event.atSeconds,
            frameTimeMs: event.frameTimeMs,
            kind: 'gpu-work',
            evidence: [],
          },
        ],
      },
    };

    expect(inspectableStutters(capture)[0]).toMatchObject({
      relatedRecommendation: { kind: 'gpu-relief' },
      recommendationAnchor: 'recommendation-1',
    });
  });

  it('не придумывает проверку, если движок её не предложил', () => {
    const source = reportCapture();
    const event = stutter(18, 85);
    const capture: Capture = {
      ...source,
      worstStutters: [event],
      recommendations: [],
      correlation: {
        ...source.correlation,
        stutters: [{ stutter: event, evidence: [{ kind: 'gpu-work', detail: 'GPU занял кадр' }] }],
      },
    };

    expect(inspectableStutters(capture)[0]).toMatchObject({
      relatedRecommendation: null,
      recommendationAnchor: null,
    });
  });
});
