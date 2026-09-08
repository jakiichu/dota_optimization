import { ok, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'graphics.game-dvr';
const TITLE = 'Фоновая запись Game DVR';

const ENABLED = 1;

/**
 * Фоновая запись держит постоянно активный энкодер и очередь захвата кадров.
 * Это прямой и измеримый расход GPU и заметная добавка к frametime.
 */
export const gameDvrRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const { gameDvrEnabled, allowGameDvr } = snapshot.graphics;

    const disabledByPolicy = allowGameDvr === 0;
    const enabledByUser = gameDvrEnabled === ENABLED;

    if (disabledByPolicy || gameDvrEnabled === 0) {
      return ok(
        ID,
        TITLE,
        `GameDVR_Enabled = ${String(gameDvrEnabled)}, AllowGameDVR = ${String(allowGameDvr)}`,
        'Фоновая запись отключена.',
      );
    }

    if (!enabledByUser) {
      return ok(
        ID,
        TITLE,
        'GameDVR_Enabled не задан',
        'Явной фоновой записи не найдено.',
      );
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'warning',
      summary: 'Фоновая запись Game DVR включена.',
      observed: 'GameConfigStore\\GameDVR_Enabled = 1',
      expected: 'GameDVR_Enabled = 0',
      impact:
        'Фоновый захват постоянно держит аппаратный энкодер и перехватывает презенты, ' +
        'что стабильно добавляет к frametime и утяжеляет хвост распределения.',
      remediation: [
        'Параметры → Игры → Записи — выключить «Записывать в фоновом режиме».',
        'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f',
      ],
    };
  },
};
