import { ok, type Finding } from '../diagnostics/finding.ts';
import type { SystemSnapshot } from '../snapshot/system-snapshot.ts';
import { gpuPreferenceFor, hasSwitchableGraphics } from '../snapshot/system-snapshot.ts';
import type { AuditRule } from './audit-rule.ts';

const ID = 'game.gpu-preference';
const TITLE = 'Видеоядро для игры';

/** Значения GpuPreference из UserGpuPreferences. */
const LET_WINDOWS_DECIDE = '0';
const POWER_SAVING = '1';
const HIGH_PERFORMANCE = '2';

function readPreference(raw: string): string | null {
  const match = /GpuPreference=(\d+)/.exec(raw);
  return match?.[1] ?? null;
}

/**
 * На ноутбуке с двумя видеоядрами игра, уехавшая на встроенное, теряет кратно
 * больше кадров, чем даёт любая настройка графики. Проверять это надо до того,
 * как советовать что-либо ещё.
 */
export const gameGpuPreferenceRule: AuditRule = {
  id: ID,
  title: TITLE,
  evaluate(snapshot: SystemSnapshot): Finding | null {
    if (!hasSwitchableGraphics(snapshot)) {
      return null;
    }

    const playable = snapshot.games.filter((game) => game.executablePath !== null);
    if (playable.length === 0) {
      return null;
    }

    const described = playable.map((game) => {
      const raw = gpuPreferenceFor(snapshot, game.executablePath as string);
      return { game, value: raw === null ? null : readPreference(raw) };
    });

    const onIntegrated = described.filter((entry) => entry.value === POWER_SAVING);
    if (onIntegrated.length > 0) {
      return {
        ruleId: ID,
        title: TITLE,
        severity: 'critical',
        summary: 'Игра принудительно привязана к энергосберегающему видеоядру.',
        observed: onIntegrated
          .map((entry) => `${entry.game.name}: GpuPreference=1 (энергосбережение)`)
          .join('; '),
        expected: 'GpuPreference=2 — высокая производительность',
        impact:
          'Встроенное видеоядро даёт в разы меньше кадров, чем дискретное. Пока игра ' +
          'привязана к нему, любые другие настройки графики не имеют значения.',
        remediation: [
          'Параметры → Система → Дисплей → Графика — найти игру и выбрать «Высокая производительность».',
          'После смены проверить, что в игре отображается дискретный GPU.',
        ],
      };
    }

    const undecided = described.filter(
      (entry) => entry.value === null || entry.value === LET_WINDOWS_DECIDE,
    );
    if (undecided.length === 0) {
      return ok(
        ID,
        TITLE,
        described.map((entry) => `${entry.game.name}: GpuPreference=${entry.value}`).join('; '),
        'Игры привязаны к производительному видеоядру.',
      );
    }

    return {
      ruleId: ID,
      title: TITLE,
      severity: 'info',
      summary: 'Выбор видеоядра оставлен на усмотрение Windows.',
      observed: undecided
        .map((entry) => `${entry.game.name}: ${entry.value === null ? 'не задано' : 'решает Windows'}`)
        .join('; '),
      expected: `GpuPreference=${HIGH_PERFORMANCE} — явная привязка к дискретному GPU`,
      impact:
        'Обычно Windows выбирает правильно, но при работе от батареи и после ' +
        'обновления драйвера решение может измениться незаметно для вас.',
      remediation: [
        'Параметры → Система → Дисплей → Графика — задать игре «Высокая производительность» явно.',
      ],
    };
  },
};
