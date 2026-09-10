import { cvarOf, type PassportChange } from '../snapshot/machine-passport.ts';
import {
  DECIDING_METRICS,
  type MetricDelta,
  type MetricId,
  type SessionComparison,
} from '../telemetry/session-comparison.ts';

/**
 * Проверка собственной рекомендации.
 *
 * До сих пор инструмент говорил «ожидаем: доля рваного ритма должна упасть» — и
 * умолкал. Никто никогда не проверял, упала ли она. Это и отделяло нас от
 * любого гайда по FPS ровно на один шаг: там гипотезы тоже звучат уверенно, но
 * опровергнуть их нечем.
 *
 * Здесь предсказание становится проверяемым. И, что важнее подтверждения,
 * проверка обязана уметь сказать «не подтвердилась». Без этого человек, однажды
 * применивший вредный совет, понесёт его в конфиге дальше, а инструмент будет
 * молча советовать то же самое.
 *
 * Порогов «что считать изменением» здесь нет намеренно: их считает сравнение
 * записей. Два определения шума в одном приложении — это будущее расхождение
 * вердиктов на одних и тех же числах.
 */

export interface Prediction {
  /** Какая метрика должна сдвинуться, если гипотеза верна. */
  readonly metric: MetricId;
  readonly direction: 'down' | 'up';
  /**
   * Метрика, которой позволено ухудшиться, — объявленная цена.
   *
   * `null` — цены в измеримых величинах нет: за снятие нагрузки платят
   * качеством картинки, а его мы не меряем.
   */
  readonly cost: MetricId | null;
}

export type HypothesisOutcome =
  /** Предсказанное изменение произошло. */
  | 'confirmed'
  /** Метрика сдвинулась в обратную сторону. */
  | 'refuted'
  /** Осталась в пределах разброса: правка не сделала ничего. */
  | 'no-change'
  /** Записи несравнимы — судить не о чем. */
  | 'not-comparable'
  /** Нужной метрики нет хотя бы в одной записи. */
  | 'not-measured';

export interface HypothesisCheck {
  readonly outcome: HypothesisOutcome;
  readonly summary: string;
  /** Предсказанная метрика: как она изменилась. */
  readonly predicted: MetricDelta | null;
  /** Объявленная цена: во что это обошлось. */
  readonly paid: MetricDelta | null;
  /**
   * Предсказание сбылось, но просело что-то другое.
   *
   * Так бывает: ритм выровнялся, а p99 вырос вдвое. Промолчать об этом значило
   * бы дать зелёную галочку изменению, которое человеку навредило.
   *
   * Общим вердиктом сравнения это не поймать: когда одно улучшилось, а другое
   * ухудшилось, он честно говорит «без изменений». Поэтому смотрим прямо на
   * метрики — на те, по которым вердикт и выносится.
   */
  readonly betterOnPaper: boolean;
  /** Что именно просело, кроме объявленной цены. */
  readonly regressed: readonly MetricDelta[];
}

export function checkHypothesis(
  prediction: Prediction,
  comparison: SessionComparison,
): HypothesisCheck {
  const predicted = find(comparison, prediction.metric);
  const paid = prediction.cost === null ? null : find(comparison, prediction.cost);

  if (!comparison.comparable) {
    return {
      outcome: 'not-comparable',
      summary:
        'Проверить нельзя: записи сделаны в разных сценах. ' +
        'Разница между ними не имеет отношения к правке.',
      predicted,
      paid,
      betterOnPaper: false,
      regressed: [],
    };
  }

  if (predicted === null) {
    return {
      outcome: 'not-measured',
      summary:
        'Проверить нечем: этой метрики нет хотя бы в одной из записей.',
      predicted: null,
      paid,
      betterOnPaper: false,
      regressed: [],
    };
  }

  const moved = movement(predicted);
  const outcome: HypothesisOutcome =
    moved === 'same' ? 'no-change' : moved === prediction.direction ? 'confirmed' : 'refuted';

  // Объявленную цену в просадки не записываем: о ней предупреждали заранее,
  // и человек согласился на неё, нажимая «проверить».
  const regressed = comparison.metrics.filter(
    (delta) =>
      DECIDING_METRICS.has(delta.id) &&
      delta.verdict === 'worse' &&
      delta.id !== prediction.metric &&
      delta.id !== prediction.cost,
  );
  const betterOnPaper = outcome === 'confirmed' && regressed.length > 0;

  return {
    outcome,
    summary: describe(outcome, predicted, paid, regressed),
    predicted,
    paid,
    betterOnPaper,
    regressed,
  };
}

/**
 * Что поменялось между записями сверх обещанного.
 *
 * Проверка предсказания строга к числам и слепа к условиям опыта: она скажет
 * «подтвердилась» и тогда, когда вместе с предсказанной настройкой человек
 * поменял ещё пять. Вывод в таком случае может быть не про ту настройку вовсе,
 * и промолчать об этом — значит выдать совпадение за доказательство.
 *
 * Настройки принимаются именами переменных: брать сюда саму рекомендацию
 * нельзя, она сама зависит от этого модуля.
 */
export function unexpectedChanges(
  expectedCvars: readonly string[],
  changes: readonly PassportChange[],
): readonly PassportChange[] {
  const expected = new Set(expectedCvars.map((name) => name.toLowerCase()));
  return changes.filter((change) => {
    const cvar = cvarOf(change);
    return cvar === null || !expected.has(cvar);
  });
}

function find(comparison: SessionComparison, metric: MetricId): MetricDelta | null {
  return comparison.metrics.find((delta) => delta.id === metric) ?? null;
}

/** В какую сторону метрика поехала — с учётом порогов из сравнения. */
function movement(delta: MetricDelta): 'down' | 'up' | 'same' {
  if (delta.verdict === 'same') return 'same';
  return delta.delta < 0 ? 'down' : 'up';
}

function describe(
  outcome: HypothesisOutcome,
  predicted: MetricDelta,
  paid: MetricDelta | null,
  regressed: readonly MetricDelta[],
): string {
  const numbers = quote(predicted);

  if (outcome === 'no-change') {
    return (
      `Не подтвердилась: ${numbers} — это разброс, а не результат. ` +
      'Правка не сделала того, ради чего её предлагали.'
    );
  }

  if (outcome === 'refuted') {
    return `Опровергнута: ${numbers} — сдвинулось в обратную сторону. Верните настройку как было.`;
  }

  const cost =
    paid === null
      ? ''
      : paid.verdict === 'same'
        ? ` Цены не оказалось: ${quote(paid)}.`
        : ` Цена: ${quote(paid)} — о ней предупреждали заранее.`;

  const warning =
    regressed.length === 0
      ? ''
      : ` Но в целом стало хуже: ${regressed.map(quote).join(', ')} — об этом не предупреждали.`;

  return `Подтвердилась: ${numbers}.${cost}${warning}`;
}

function quote(delta: MetricDelta): string {
  const unit = delta.unit === '' ? '' : ` ${delta.unit}`;
  return (
    `${delta.label.toLowerCase()} ${delta.before.toFixed(1)} → ` +
    `${delta.after.toFixed(1)}${unit}`
  );
}
