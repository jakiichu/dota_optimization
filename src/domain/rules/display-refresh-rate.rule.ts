import { ok, unknown, type Finding } from '../diagnostics/finding.ts';
import type { DisplayInfo, SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'display.refresh-rate';
const TITLE = 'Частота обновления монитора';

interface RatedDisplay {
  readonly display: DisplayInfo;
  readonly current: number;
  readonly max: number;
}

function withKnownRates(displays: readonly DisplayInfo[]): RatedDisplay[] {
  const rated: RatedDisplay[] = [];
  for (const display of displays) {
    const { currentRefreshHz, maxRefreshHz } = display;
    if (currentRefreshHz !== null && maxRefreshHz !== null && maxRefreshHz > 0) {
      rated.push({ display, current: currentRefreshHz, max: maxRefreshHz });
    }
  }
  return rated;
}

/**
 * Самая частая и самая обидная потеря: монитор умеет 144 Гц, а Windows после
 * переустановки драйвера выставила 60. Никакая оптимизация рендера этого не
 * компенсирует.
 */
export const displayRefreshRateRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const rated = withKnownRates(snapshot.displays);
    if (rated.length === 0) {
      return unknown(ID, TITLE, 'Win32_VideoController не вернул частоты обновления.');
    }

    const underdriven = rated.filter((entry) => entry.current < entry.max);
    if (underdriven.length === 0) {
      const rates = rated
        .map((entry) => `${entry.display.adapterName}: ${entry.current} Гц`)
        .join('; ');
      return ok(ID, TITLE, rates, 'Все выходы работают на максимальной частоте.');
    }

    const details = underdriven
      .map((entry) => `${entry.display.adapterName}: ${entry.current} Гц из ${entry.max} Гц`)
      .join('; ');

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'critical',
      summary: 'Монитор работает ниже своей максимальной частоты.',
      observed: details,
      expected: 'Текущая частота равна максимальной поддерживаемой',
      impact:
        'Кадры, отрисованные сверх частоты обновления, не доходят до экрана. Это ' +
        'прямая потеря плавности и лишний инпут-лаг, которых не видно ни в одном ' +
        'счётчике FPS.',
      remediation: [
        'Параметры → Система → Дисплей → Расширенные параметры дисплея — выбрать максимальную частоту.',
        'Проверить кабель: для высоких частот нужен DisplayPort или HDMI 2.0 и выше.',
        'После обновления драйвера GPU проверить заново — частота часто сбрасывается.',
      ],
    };
  },
};
