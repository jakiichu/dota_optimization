import { unknown, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'power.core-parking';
const TITLE = 'Парковка ядер процессора';

const NO_PARKING_PERCENT = 100;

export const coreParkingRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const minCores = snapshot.power.minProcessorCoresPercentAc;
    if (minCores === null) {
      return unknown(
        ID,
        TITLE,
        'Не удалось прочитать значение CPMINCORES активной схемы.',
      );
    }

    if (minCores >= NO_PARKING_PERCENT) {
      return {
        ruleId: ID,
        title: TITLE,
        severity: 'ok',
        summary: 'Парковка ядер отключена.',
        observed: `CPMINCORES (от сети) = ${minCores}%`,
        expected: '100%',
        impact: '',
        remediation: [],
      };
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: `Windows может парковать до ${NO_PARKING_PERCENT - minCores}% ядер.`,
      observed: `CPMINCORES (от сети) = ${minCores}%`,
      expected: 'Оценивать по записи игры, а не только по настройке схемы питания',
      impact: 'Разрешённая парковка не доказывает, что ядра парковались во время игры или вызывали рывки. Влияние зависит от процессора и нагрузки.',
      remediation: [
        'Сначала запишите повторяемый участок игры. Менять эту настройку только по результату аудита не требуется.',
        'Если проверяете другую схему питания, сравните тот же участок до и после и учитывайте нагрев и расход энергии.',
      ],
    };
  },
};
