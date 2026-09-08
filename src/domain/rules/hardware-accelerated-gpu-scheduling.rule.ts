import { unknown, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'graphics.hags';
const TITLE = 'Аппаратное планирование GPU (HAGS)';

const MODE_ENABLED = 2;

/**
 * HAGS перекладывает планирование работы GPU с драйвера на сам GPU. На кадры
 * влияет в обе стороны: обычно снижает задержку и нужен для Frame Generation,
 * но на части конфигураций даёт периодические статтеры. Поэтому это `info`, а
 * не «включи немедленно», — здесь нужен A/B-замер, а не совет вслепую.
 */
export const hardwareAcceleratedGpuSchedulingRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const { hwSchMode } = snapshot.graphics;
    if (hwSchMode === null) {
      return unknown(
        ID,
        TITLE,
        'Ключа GraphicsDrivers\\HwSchMode нет: HAGS либо не поддерживается платформой, ' +
          'либо ни разу не переключался вручную.',
      );
    }

    const enabled = hwSchMode === MODE_ENABLED;
    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: enabled ? 'HAGS включён.' : 'HAGS выключен.',
      observed: `HwSchMode = ${hwSchMode} (${enabled ? 'включён' : 'выключен'})`,
      expected: 'Значение, которое лучше в замере на вашей машине',
      impact:
        'HAGS меняет frame pacing: у одних конфигураций снижает инпут-лаг, у других ' +
        'вызывает регулярные статтеры. Универсально правильного значения нет.',
      remediation: [
        'Снимите frametime-сессию с текущим значением.',
        'Параметры → Система → Дисплей → Графика → Стандартные параметры графики — переключите HAGS.',
        'Перезагрузитесь и снимите вторую сессию.',
        'Сравните p99 и число статтеров, а не средний FPS.',
      ],
    };
  },
};
