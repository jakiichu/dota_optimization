import { ok, type Finding } from '../diagnostics/finding.ts';
import type { GameProfile, SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'game.launch-options';
const TITLE = 'Параметры запуска';

interface SuspectOption {
  /** Регулярка по всей строке параметров. */
  readonly pattern: RegExp;
  readonly label: string;
  readonly why: string;
  readonly advice: string;
}

/**
 * Параметры, которые массово советуют в гайдах и которые чаще вредят, чем
 * помогают. Здесь не «список запрещённого», а список того, что стоит перемерить
 * самому: каждый пункт объясняет, чем именно он рискован.
 */
const SUSPECT_OPTIONS: readonly SuspectOption[] = [
  {
    pattern: /(^|\s)-threads\s+\d+/,
    label: '-threads',
    why:
      'Source 2 сама раскладывает работу по ядрам. Ручное число потоков обычно ' +
      'мешает планировщику и добавляет статтеры, а не убирает их.',
    advice: 'Убрать -threads и перемерить frametime.',
  },
  {
    pattern: /(^|\s)-high(\s|$)/,
    label: '-high',
    why:
      'Высокий приоритет процесса может обделять потоки звука, ввода и сети. ' +
      'Иногда помогает, иногда даёт микрофризы — это не безусловное улучшение.',
    advice: 'Сравнить две сессии: с -high и без него.',
  },
  {
    pattern: /(^|\s)\+fps_max\s+0(\s|$)/,
    label: '+fps_max 0',
    why:
      'Без потолка кадров GPU и CPU работают на максимум, растёт нагрев и ' +
      'портится равномерность кадров, хотя средний FPS выглядит выше.',
    advice: 'Поставить fps_max немного ниже частоты монитора.',
  },
];

function describeGame(game: GameProfile): string {
  return `${game.name}: ${game.launchOptions ?? 'параметры не заданы'}`;
}

export const gameLaunchOptionsRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    if (snapshot.games.length === 0) {
      return null;
    }

    const hits: { game: GameProfile; option: SuspectOption }[] = [];
    for (const game of snapshot.games) {
      const options = game.launchOptions;
      if (options === null) continue;
      for (const suspect of SUSPECT_OPTIONS) {
        if (suspect.pattern.test(options)) {
          hits.push({ game, option: suspect });
        }
      }
    }

    if (hits.length === 0) {
      return ok(
        ID,
        TITLE,
        snapshot.games.map(describeGame).join('; '),
        'Подозрительных параметров запуска нет.',
      );
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: 'Есть параметры запуска, которые стоит перепроверить замером.',
      observed: hits
        .map((hit) => `${hit.game.name}: ${hit.option.label}`)
        .join('; '),
      expected: 'Только те параметры, выигрыш от которых вы измерили сами',
      impact: hits.map((hit) => `${hit.option.label} — ${hit.option.why}`).join(' '),
      remediation: hits.map((hit) => hit.option.advice),
    };
  },
};
