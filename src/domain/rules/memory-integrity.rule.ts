import { ok, unknown, type Finding } from '../diagnostics/finding.ts';
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
    if (hvci === null)
      return unknown(ID, TITLE, 'Состояние целостности памяти не удалось прочитать.');
    if (hvci === 0) {
      return ok(
        ID,
        TITLE,
        `HypervisorEnforcedCodeIntegrity = ${hvci === null ? 'не задан' : '0'}`,
        'В прочитанной настройке HVCI отключён.',
      );
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: 'В настройке HVCI включена защита целостности памяти.',
      observed: 'HypervisorEnforcedCodeIntegrity\\Enabled = 1',
      expected: 'Сохранять защиту включённой; влияние оценивать по измерениям',
      impact:
        'Влияние защиты на производительность зависит от оборудования и нагрузки. Этот снимок не измеряет потери FPS и не подтверждает фактическое состояние после перезагрузки.',
      remediation: [
        'Проверить состояние: Безопасность Windows → Безопасность устройства → Изоляция ядра → Целостность памяти.',
        'Для поиска причин рывков сначала запишите игру. Отключение защиты не является рекомендацией этой проверки.',
      ],
    };
  },
};
