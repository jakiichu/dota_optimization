import type { Maybe } from '../snapshot/system-snapshot.ts';

/**
 * Что именно записывали.
 *
 * Оказалось важнее всех метрик разом. Проба героя, начало игры и затяжной
 * замес дают разную нагрузку, и записи из разных сцен несравнимы — сколько бы
 * аккуратно ни считались перцентили. Инструмент, который молча сравнивает
 * такие записи, выдаёт разницу сцен за результат правки.
 *
 * Поэтому сцена — обязательная часть записи, а не подпись «на память».
 */

export type SceneKind =
  /** Повтор матча: одни и те же кадры при каждом проигрывании. */
  | 'replay'
  /** Проба героя: нагрузка невысокая, но повторяемая. */
  | 'hero-demo'
  /** Живой матч: воспроизвести нельзя. */
  | 'match'
  /** Меню и панель: рисуется интерфейс, а не игра. */
  | 'menu'
  /** Не указали. */
  | 'unknown';

export const SCENE_LABEL: Record<SceneKind, string> = {
  replay: 'повтор матча',
  'hero-demo': 'проба героя',
  match: 'живой матч',
  menu: 'меню',
  unknown: 'сцена не указана',
};

export interface CaptureScene {
  readonly kind: SceneKind;
  /** Файл повтора, если записывали повтор. */
  readonly replayFile: Maybe<string>;
  /** Тик, с которого начинали, — вместе с файлом задаёт точку в матче. */
  readonly startTick: Maybe<number>;
  /** Что человек добавил от себя. */
  readonly note: Maybe<string>;
}

export const UNKNOWN_SCENE: CaptureScene = {
  kind: 'unknown',
  replayFile: null,
  startTick: null,
  note: null,
};

export function describeScene(scene: CaptureScene): string {
  const parts = [SCENE_LABEL[scene.kind]];
  if (scene.replayFile !== null) {
    parts.push(
      scene.startTick === null
        ? scene.replayFile
        : `${scene.replayFile}, тик ${scene.startTick}`,
    );
  }
  if (scene.note !== null) parts.push(scene.note);
  return parts.join(' · ');
}

/**
 * Можно ли сравнивать две записи.
 *
 * Повторяемой считается только та сцена, которую можно воспроизвести точно:
 * тот же повтор с того же тика. Проба героя повторяема условно — нагрузка
 * похожа, но не идентична. Живой матч не повторяем вовсе.
 */
export function isReproducible(scene: CaptureScene): boolean {
  return scene.kind === 'replay' && scene.replayFile !== null && scene.startTick !== null;
}

export interface SceneMismatch {
  readonly comparable: boolean;
  /** Почему сравнение неточное или невозможное. Пусто — сцены совпадают. */
  readonly reasons: readonly string[];
}

export function compareScenes(before: CaptureScene, after: CaptureScene): SceneMismatch {
  const reasons: string[] = [];

  if (before.kind !== after.kind) {
    return {
      comparable: false,
      reasons: [
        `Записи сделаны в разных сценах: ${SCENE_LABEL[before.kind]} и ` +
          `${SCENE_LABEL[after.kind]}. Разница между ними — это разница нагрузки, ` +
          'а не результат правки.',
      ],
    };
  }

  if (before.kind === 'unknown') {
    return {
      comparable: false,
      reasons: [
        'Сцена не указана ни у одной записи — сравнивать нечего с чем: ' +
          'проба героя и затяжной замес дают разные числа при любых настройках.',
      ],
    };
  }

  if (before.kind === 'replay') {
    if (before.replayFile !== after.replayFile) {
      return {
        comparable: false,
        reasons: [
          `Разные повторы: ${before.replayFile ?? '?'} и ${after.replayFile ?? '?'}.`,
        ],
      };
    }
    if (before.startTick !== after.startTick) {
      return {
        comparable: false,
        reasons: [
          `Разные точки повтора: тик ${before.startTick ?? '?'} и ${after.startTick ?? '?'}. ` +
            'В разных местах матча нагрузка разная.',
        ],
      };
    }
    // Один повтор с одного тика — единственный случай, когда сравнение точное.
    return { comparable: true, reasons: [] };
  }

  if (before.kind === 'match') {
    reasons.push(
      'Живой матч воспроизвести нельзя: даже в одной игре замес и фарм леса дают ' +
        'разную нагрузку. Для точного сравнения записывайте повтор с одного тика.',
    );
  }

  if (before.kind === 'hero-demo') {
    reasons.push(
      'Проба героя повторяема лишь примерно: нагрузка похожа, но зависит от того, ' +
        'что происходит на экране.',
    );
  }

  return { comparable: true, reasons };
}
