import type { SessionSummary } from '../telemetry/session-comparison.ts';
import type { EvidenceKind } from '../telemetry/stutter-correlation.ts';
import type { Finding } from './finding.ts';

/**
 * Сверка находок аудита с тем, что видно в записи.
 *
 * Двенадцать правил выдают общие предупреждения: «MPO включён», «экран идёт не
 * на своей частоте». Корреляция отдельно находит «рядом сменился режим вывода».
 * Свести их не пытался никто, и человек получал два разрозненных списка вместо
 * одного вывода.
 *
 * Сведённые, они дают то, ради чего инструмент и затевался: не «так бывает
 * плохо», а «у вас это происходит, вот сколько раз».
 *
 * Вторая половина важнее первой. Если в записи следов нет, предупреждение
 * можно и нужно приглушить: «включён, но в вашей записи себя не проявил».
 * Сейчас аудит пугает всех одинаково, хотя у половины людей эта настройка
 * ничего не стоит.
 *
 * **Важность находки при этом не меняется.** Одна запись — это одна запись;
 * «не проявилось у вас сегодня» и «не проблема» — разные утверждения, и
 * подменять второе первым мы не станем.
 */

export interface RuleCorroboration {
  readonly ruleId: string;
  /** Нашлись ли в записи следы того, о чём предупреждает правило. */
  readonly confirmed: boolean;
  /** Что именно в записи это подтверждает или опровергает — с числами. */
  readonly detail: string;
}

/**
 * Связь «правило — след в записи».
 *
 * Список короткий намеренно. Сюда попадает только то, где механизм прямой:
 * настройка меняет ровно то, что мы умеем измерить. Притянуть за уши можно
 * почти любую пару, но тогда «подтверждено записью» перестанет что-либо
 * значить.
 */
interface Link {
  readonly ruleId: string;
  /** Сколько раз это встретилось в записи и как об этом сказать. */
  readonly look: (measured: SessionSummary) => Trace | null;
}

interface Trace {
  readonly found: boolean;
  readonly detail: string;
}

/** Доля времени в рваном ритме, ниже которой говорить не о чем. */
const PACING_WORTH_MENTION = 0.05;

const LINKS: readonly Link[] = [
  // MPO и оптимизации полноэкранного режима меняют способ вывода картинки —
  // ровно то, что PresentMon видит как смену режима вывода.
  { ruleId: 'graphics.mpo', look: presentModeTrace },
  { ruleId: 'game.fullscreen-optimizations', look: presentModeTrace },

  // Частота экрана: если игра не попадает в развёртку, это видно как кадры,
  // кратные базовому интервалу.
  {
    ruleId: 'display.refresh-rate',
    look: (measured) =>
      measured.pacingTimeShare >= PACING_WORTH_MENTION
        ? {
            found: true,
            detail:
              `В записи «${measured.label}» ${(measured.pacingTimeShare * 100).toFixed(0)}% ` +
              'времени ушло в кадры кратно длиннее обычного — игра не попадает в развёртку.',
          }
        : {
            found: false,
            detail:
              `В записи «${measured.label}» кадры шли ровно: промахов мимо развёртки ` +
              'не видно.',
          },
  },

  // Беспроводной канал: качество связи мы меряем прямо во время записи.
  {
    ruleId: 'network.active-link',
    look: (measured) =>
      measured.networkSeverity === 'ok'
        ? {
            found: false,
            detail: `Во время записи «${measured.label}» канал держался ровно.`,
          }
        : {
            found: true,
            detail: `Во время записи «${measured.label}» канал дрожал — это измерено, а не предположено.`,
          },
  },
];

export function corroborate(
  findings: readonly Finding[],
  measured: SessionSummary | null,
): readonly RuleCorroboration[] {
  // Записей нет — молчим. «Не проявилось» и «не мерили» разные вещи, и вторая
  // не должна выглядеть как первая.
  if (measured === null) return [];

  const flagged = new Set(
    findings.filter((finding) => finding.severity !== 'ok').map((finding) => finding.ruleId),
  );

  const found: RuleCorroboration[] = [];
  for (const link of LINKS) {
    if (!flagged.has(link.ruleId)) continue;

    const trace = link.look(measured);
    if (trace === null) continue;
    found.push({ ruleId: link.ruleId, confirmed: trace.found, detail: trace.detail });
  }

  return found;
}

function presentModeTrace(measured: SessionSummary): Trace | null {
  // Статтеров не было вовсе — сверять не с чем, и молчание честнее вывода.
  if (measured.stutterCount === 0) return null;

  const count = measured.causes.find((cause) => cause.kind === presentMode)?.count ?? 0;
  return count > 0
    ? {
        found: true,
        detail:
          `В записи «${measured.label}» ${count} из ${measured.stutterCount} рывков совпали ` +
          'со сменой способа вывода картинки.',
      }
    : {
        found: false,
        detail:
          `В записи «${measured.label}» ни один из ${measured.stutterCount} рывков не совпал ` +
          'со сменой способа вывода.',
      };
}

const presentMode: EvidenceKind = 'present-mode';
