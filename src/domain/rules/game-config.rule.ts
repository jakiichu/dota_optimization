import { ok, type Finding } from '../diagnostics/finding.ts';
import type { Severity } from '../diagnostics/severity.ts';
import { analyzeGameConfig, type NoteSeverity } from '../gameconfig/config-analysis.ts';
import { IMPACT_SHORT } from '../gameconfig/cvar-knowledge.ts';
import { parseGameConfig } from '../gameconfig/game-config.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'game.config';
const TITLE = 'Конфиг игры';

const NOTE_TO_SEVERITY: Record<NoteSeverity, Severity> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

/**
 * Разбор autoexec.cfg.
 *
 * Такие конфиги ходят по интернету списками в семьдесят строк без объяснений.
 * Человек вставляет их целиком, получает какой-то результат и дальше не знает,
 * что именно у него включено, — а через полгода не помнит и откуда файл взялся.
 *
 * Правило не выносит приговор «хороший конфиг или плохой»: это решается
 * замером. Оно показывает состав и называет спорное.
 */
export const gameConfigRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    const game = snapshot.games.find((candidate) => candidate.config !== null);
    if (game === undefined || game.config === null || game.configPath === null) {
      return null;
    }

    const analysis = analyzeGameConfig(
      parseGameConfig(game.configPath, game.config),
      // Записи кадров правилу недоступны: аудит смотрит на машину, а не на игру.
      // Сопоставление с измеренным делает разбор записи.
      { pacingTimeShare: null, bottleneck: null },
    );

    const composition = analysis.tally
      .map((entry) =>
        entry.impact === 'unknown'
          ? `не знаем: ${entry.count}`
          : `${IMPACT_SHORT[entry.impact]}: ${entry.count}`,
      )
      .join(', ');
    const observed = `${analysis.settingCount} настроек в ${analysis.path}. ${composition}.`;

    if (analysis.notes.length === 0) {
      return ok(ID, TITLE, observed, 'Конфиг разобран, спорного не нашлось.');
    }

    const worst = analysis.notes.reduce(
      (highest, note) => (rank(note.severity) > rank(highest) ? note.severity : highest),
      'info' as NoteSeverity,
    );

    return {
      ruleId: ID,
      title: TITLE,
      severity: NOTE_TO_SEVERITY[worst],
      summary: analysis.notes[0]?.title ?? 'В конфиге есть на что посмотреть.',
      observed,
      expected: 'Настройки, выигрыш от которых вы измерили сами',
      impact: analysis.notes.map((note) => note.detail).join(' '),
      remediation: analysis.notes.flatMap((note) => note.remediation),
    };
  },
};

function rank(severity: NoteSeverity): number {
  if (severity === 'critical') return 2;
  if (severity === 'warning') return 1;
  return 0;
}
