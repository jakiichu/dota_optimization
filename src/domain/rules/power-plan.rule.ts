import { unknown, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'power.core-parking';
const TITLE = 'Парковка ядер процессора';

const NO_PARKING_PERCENT = 100;

/**
 * Припаркованное ядро нужно разбудить, прежде чем оно возьмёт работу. Для
 * игрового потока это добавляет задержку именно в момент всплеска нагрузки —
 * то есть ровно там, где рождается статтер.
 */
export const coreParkingRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const minCores = snapshot.power.minProcessorCoresPercentAc;
    if (minCores === null) {
      return unknown(
        ID,
        TITLE,
        'CPMINCORES не задан в активной схеме — действует значение по умолчанию.',
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
      severity: 'warning',
      summary: `Windows может парковать до ${NO_PARKING_PERCENT - minCores}% ядер.`,
      observed: `CPMINCORES (от сети) = ${minCores}%`,
      expected: '100% — все ядра всегда доступны планировщику',
      impact:
        'Пробуждение припаркованного ядра занимает время именно в момент всплеска ' +
        'нагрузки, поэтому парковка проявляется как отдельные длинные кадры, а не ' +
        'как падение среднего FPS.',
      remediation: [
        'powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR CPMINCORES 100',
        'powercfg /setactive SCHEME_CURRENT',
        'На ноутбуке менять только профиль «от сети»: от батареи парковка полезна.',
      ],
    };
  },
};
