import { analyzeGameConfig, type ConfigAnalysis, type MeasuredContext } from '../../domain/gameconfig/config-analysis.ts';
import { withSetting, withoutSetting } from '../../domain/gameconfig/config-edit.ts';
import { parseGameConfig, type GameConfig } from '../../domain/gameconfig/game-config.ts';
import type { GameConfigStore } from '../ports/game-config.port.ts';

/**
 * Работа с конфигом игры: прочитать, поправить, заменить, удалить, вынести копию.
 *
 * Правки приходят списком «имя — значение», а не готовым файлом. Разница
 * принципиальная: получив текст целиком, мы бы записали поверх файла то, что
 * интерфейс прочитал минуту назад, — и потеряли бы всё, что человек за эту
 * минуту поменял руками. Список правок ложится на текущее содержимое.
 */

export interface ConfigChangeRequest {
  readonly name: string;
  /** `null` — убрать настройку из файла целиком. */
  readonly value: string | null;
}

export interface GameConfigState {
  /** Где игра ждёт конфиг. `null` — игру найти не удалось. */
  readonly path: string | null;
  /** Есть ли файл. Отсутствие конфига — норма, а не ошибка. */
  readonly exists: boolean;
  readonly text: string;
  readonly config: GameConfig | null;
  readonly analysis: ConfigAnalysis | null;
  /** Куда сохранилась прежняя версия при последней правке. */
  readonly backupPath: string | null;
}

const NO_GAME: GameConfigState = {
  path: null,
  exists: false,
  text: '',
  config: null,
  analysis: null,
  backupPath: null,
};

export class ManageGameConfig {
  readonly #store: GameConfigStore;
  readonly #measured: () => Promise<MeasuredContext>;

  /**
   * Замеры нужны, чтобы разбор конфига говорил не вообще, а про эту машину:
   * снятый потолок кадров безобиден там, где игра попадает в развёртку, и
   * вреден там, где не попадает.
   */
  constructor(store: GameConfigStore, measured: () => Promise<MeasuredContext>) {
    this.#store = store;
    this.#measured = measured;
  }

  async read(): Promise<GameConfigState> {
    const stored = await this.#store.read();
    if (stored === null) return NO_GAME;
    return this.#describe(stored.path, stored.text, null);
  }

  /** Точечные правки поверх текущего содержимого файла. */
  async apply(changes: readonly ConfigChangeRequest[]): Promise<GameConfigState> {
    const stored = await this.#store.read();
    if (stored === null) return NO_GAME;

    const updated = changes.reduce(
      (text, change) =>
        change.value === null
          ? withoutSetting(text, change.name)
          : withSetting(text, change.name, change.value),
      stored.text ?? '',
    );

    const written = await this.#store.write(updated);
    return this.#describe(written.path, updated, written.backupPath);
  }

  /**
   * Замена файла целиком — для конфига, вставленного или принесённого с другой
   * машины. Прежний уезжает в резервную копию, а не пропадает.
   */
  async replace(text: string): Promise<GameConfigState> {
    const written = await this.#store.write(text);
    return this.#describe(written.path, text, written.backupPath);
  }

  async remove(): Promise<GameConfigState> {
    const removed = await this.#store.remove();
    return this.#describe(removed.path, null, removed.backupPath);
  }

  copyToDesktop(): Promise<string> {
    return this.#store.copyToDesktop();
  }

  async #describe(
    path: string,
    text: string | null,
    backupPath: string | null,
  ): Promise<GameConfigState> {
    if (text === null) {
      return { path, exists: false, text: '', config: null, analysis: null, backupPath };
    }

    const config = parseGameConfig(path, text);
    return {
      path,
      exists: true,
      text,
      config,
      analysis: analyzeGameConfig(config, await this.#measured()),
      backupPath,
    };
  }
}
