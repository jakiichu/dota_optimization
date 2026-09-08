import { ok, unknown, type Finding } from '../diagnostics/finding.ts';
import type { GpuInfo, SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'driver.freshness';
const TITLE = 'Возраст драйвера видеокарты';

const DAYS_IN_MONTH = 30;
const STALE_MONTHS = 12;
const VERY_STALE_MONTHS = 24;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function monthsBetween(from: string, to: Date): number | null {
  const parsed = Date.parse(from);
  if (Number.isNaN(parsed)) return null;
  const days = (to.getTime() - parsed) / MS_PER_DAY;
  return days < 0 ? 0 : days / DAYS_IN_MONTH;
}

function describe(gpu: GpuInfo, months: number): string {
  return `${gpu.name}: драйвер от ${gpu.driverDate ?? '?'} (${Math.floor(months)} мес.)`;
}

/**
 * Возраст считаем по дате драйвера, а не по номеру версии: схемы нумерации у
 * NVIDIA, AMD и Intel несравнимы между собой.
 */
export const driverFreshnessRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const now = new Date(snapshot.capturedAt);
    const aged: { gpu: GpuInfo; months: number }[] = [];

    for (const gpu of snapshot.gpus) {
      if (gpu.vendor === 'unknown' || gpu.driverDate === null) continue;
      const months = monthsBetween(gpu.driverDate, now);
      if (months !== null) aged.push({ gpu, months });
    }

    if (aged.length === 0) {
      return unknown(ID, TITLE, 'Дата драйвера недоступна ни для одного адаптера.');
    }

    const oldest = aged.reduce((worst, entry) =>
      entry.months > worst.months ? entry : worst,
    );

    if (oldest.months < STALE_MONTHS) {
      return ok(
        ID,
        TITLE,
        describe(oldest.gpu, oldest.months),
        'Драйвер достаточно свежий.',
      );
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: oldest.months >= VERY_STALE_MONTHS ? 'warning' : 'info',
      summary: `Драйверу больше ${oldest.months >= VERY_STALE_MONTHS ? VERY_STALE_MONTHS : STALE_MONTHS} месяцев.`,
      observed: aged.map((entry) => describe(entry.gpu, entry.months)).join('; '),
      expected: `Драйвер не старше ${STALE_MONTHS} месяцев`,
      impact:
        'Исправления frame pacing, работы с MPO и планированием GPU приезжают ' +
        'именно с драйвером. На старом драйвере вы чините проблемы, которые вендор ' +
        'уже починил.',
      remediation: [
        'Обновить драйвер с сайта производителя GPU, а не через Windows Update.',
        'После обновления заново проверить частоту обновления монитора — она часто сбрасывается.',
      ],
    };
  },
};
