import { ok, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'network.active-link';
const TITLE = 'Активное сетевое подключение';

const LINK_UP = 'Up';

/**
 * Сетевой джиттер ощущается как рывок изображения, но frametime при этом
 * идеально ровный. Не различив эти два случая, инструмент будет уверенно
 * чинить не ту проблему.
 */
export const wirelessLinkRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const active = snapshot.networkAdapters.filter((adapter) => adapter.status === LINK_UP);
    if (active.length === 0) {
      return null;
    }

    const wireless = active.filter((adapter) => adapter.isWireless);
    const wired = active.filter((adapter) => !adapter.isWireless);

    if (wireless.length === 0) {
      return ok(
        ID,
        TITLE,
        wired.map((adapter) => adapter.name).join(', '),
        'Подключение проводное.',
      );
    }

    const savesPower = wireless.some(
      (adapter) => adapter.allowComputerToTurnOffDevice === true,
    );

    const remediation = ['Проверять «лаги» сначала по джиттеру пинга, а не по frametime.'];
    if (savesPower) {
      remediation.push(
        'Диспетчер устройств → адаптер → Управление электропитанием — снять «Разрешить отключение этого устройства».',
      );
    }
    if (wired.length === 0) {
      remediation.push('По возможности перейти на кабель — это убирает целый класс причин.');
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: wired.length > 0 ? 'info' : 'warning',
      summary: 'Трафик может идти через Wi-Fi.',
      observed: wireless
        .map(
          (adapter) =>
            `${adapter.name} (${adapter.interfaceDescription}), энергосбережение: ` +
            `${adapter.allowComputerToTurnOffDevice === true ? 'разрешено' : 'запрещено'}`,
        )
        .join('; '),
      expected: 'Проводное подключение либо Wi-Fi с отключённым энергосбережением',
      impact:
        'Wi-Fi даёт всплески задержки в десятки и сотни миллисекунд. На экране это ' +
        'выглядит как статтер, хотя кадры рендерятся ровно, — и «оптимизация графики» ' +
        'такую проблему не лечит.',
      remediation,
    };
  },
};
