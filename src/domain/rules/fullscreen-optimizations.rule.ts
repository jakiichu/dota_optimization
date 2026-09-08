import { ok, type Finding } from '../diagnostics/finding.ts';
import type { GameProfile, SystemSnapshot } from '../snapshot/system-snapshot.ts';
import { appCompatFor } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'game.fullscreen-optimizations';
const TITLE = 'Оптимизации полноэкранного режима';

/** Слой совместимости, отключающий FSO для конкретного .exe. */
const FSO_DISABLED = 'DISABLEDXMAXIMIZEDWINDOWEDMODE';

interface GameLayers {
  readonly game: GameProfile;
  readonly layers: string;
}

/**
 * FSO подменяет исключительный полноэкранный режим композицией DWM. На
 * современной Windows это обычно снижает задержку и включает Auto HDR, но на
 * части конфигураций даёт неровный frame pacing.
 *
 * Отключение FSO — популярный совет из гайдов, поэтому его чаще выставляют, чем
 * измеряют. Мы только показываем состояние: правильного ответа без замера нет.
 */
export const fullscreenOptimizationsRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const withExecutable = snapshot.games.filter((game) => game.executablePath !== null);
    if (withExecutable.length === 0) {
      return null;
    }

    const disabled: GameLayers[] = [];
    for (const game of withExecutable) {
      const layers = appCompatFor(snapshot, game.executablePath as string);
      if (layers !== null && layers.toUpperCase().includes(FSO_DISABLED)) {
        disabled.push({ game, layers });
      }
    }

    if (disabled.length === 0) {
      return ok(
        ID,
        TITLE,
        withExecutable.map((game) => `${game.name}: слой совместимости не задан`).join('; '),
        'FSO работает в режиме по умолчанию.',
      );
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: 'Для игры вручную отключены оптимизации полноэкранного режима.',
      observed: disabled.map((entry) => `${entry.game.name}: ${entry.layers}`).join('; '),
      expected: 'То значение, которое выиграло в замере на вашей машине',
      impact:
        'Отключение FSO возвращает исключительный полноэкранный режим. Раньше это ' +
        'почти всегда снижало задержку, на актуальной Windows — уже не всегда, зато ' +
        'ломает Auto HDR и быстрое переключение окон.',
      remediation: [
        'Снять галку «Отключить оптимизации во весь экран» в свойствах dota2.exe.',
        'Сравнить p99 frametime и инпут-лаг до и после, а не полагаться на гайд.',
      ],
    };
  },
};
