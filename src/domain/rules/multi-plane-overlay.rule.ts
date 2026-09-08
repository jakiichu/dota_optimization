import { ok, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'graphics.mpo';
const TITLE = 'Multi-Plane Overlay (MPO)';

const OVERLAY_TEST_MODE_DISABLED = 5;

/**
 * MPO позволяет DWM отдавать окна отдельными аппаратными плоскостями. Известный
 * источник мерцания и микрофризов в оконном и «безрамочном» режимах — ровно в
 * том, в котором обычно играют в Dota.
 */
export const multiPlaneOverlayRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const mode = snapshot.graphics.overlayTestMode;
    if (mode === OVERLAY_TEST_MODE_DISABLED) {
      return ok(ID, TITLE, 'OverlayTestMode = 5', 'MPO отключён.');
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: 'MPO активен (значение по умолчанию).',
      observed:
        mode === null
          ? 'Dwm\\OverlayTestMode отсутствует — MPO работает по умолчанию'
          : `OverlayTestMode = ${mode}`,
      expected: 'OverlayTestMode = 5, если ловите мерцание или микрофризы в окне',
      impact:
        'MPO — известная причина мерцания и коротких фризов в оконном и безрамочном ' +
        'режимах на драйверах NVIDIA и AMD. Отключение стоит немного энергии на ноутбуке.',
      remediation: [
        'Проверять только если статтеры уже видны в оконном режиме.',
        'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm" /v OverlayTestMode /t REG_DWORD /d 5 /f',
        'Перезагрузиться и сравнить frametime-сессии до и после.',
      ],
    };
  },
};
