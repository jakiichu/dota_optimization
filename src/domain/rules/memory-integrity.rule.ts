import { ok, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'security.hvci';
const TITLE = 'Целостность памяти (HVCI)';

/**
 * HVCI прогоняет драйверы через гипервизор. Это реальная защита с реальной
 * ценой: на игровых нагрузках потери обычно в единицах процентов, а на слабом
 * CPU — заметнее. Ставим `info`: выключение защиты — осознанный размен, а не
 * оптимизация по умолчанию.
 */
export const memoryIntegrityRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const hvci = snapshot.security.hypervisorEnforcedCodeIntegrityEnabled;
    if (hvci === null || hvci === 0) {
      return ok(
        ID,
        TITLE,
        `HypervisorEnforcedCodeIntegrity = ${hvci === null ? 'не задан' : '0'}`,
        'HVCI не включён — накладных расходов нет.',
      );
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: 'HVCI включён — это стоит процессорного времени.',
      observed: 'HypervisorEnforcedCodeIntegrity\\Enabled = 1',
      expected: 'Решение за вами: защита против нескольких процентов кадров',
      impact:
        'Виртуализация проверок целостности кода добавляет накладные расходы на ' +
        'системные вызовы и работу драйверов. На CPU-bound сцене это видно как ' +
        'ровное снижение кадров, а не как статтеры.',
      remediation: [
        'Безопасность Windows → Безопасность устройства → Изоляция ядра → Целостность памяти.',
        'Выключать только если замер до и после действительно показал разницу.',
      ],
    };
  },
};
