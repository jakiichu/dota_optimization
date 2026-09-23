import type {
  AccountControlsStore,
  SettingsTransferMode,
  ControlTransferResult,
  SteamControlProfile,
} from '../ports/account-controls.port.ts';

/** Перенос локальных настроек Dota с выбранным объёмом копирования. */
export class TransferAccountControls {
  readonly #store: AccountControlsStore;

  constructor(store: AccountControlsStore) {
    this.#store = store;
  }

  list(): Promise<readonly SteamControlProfile[]> {
    return this.#store.list();
  }

  backups() {
    return this.#store.backups?.() ?? Promise.resolve([]);
  }

  async restore(targetId: string, backupId: string) {
    if (!/^\d+$/.test(targetId) || !/^\d+-[0-9a-f-]{36}$/i.test(backupId))
      throw new Error('Неверно указана резервная копия.');
    if (!this.#store.restore) throw new Error('Восстановление недоступно.');
    return this.#store.restore(targetId, backupId);
  }

  async transfer(
    sourceId: string,
    targetId: string,
    mode?: SettingsTransferMode,
  ): Promise<ControlTransferResult> {
    if (!/^\d+$/.test(sourceId) || !/^\d+$/.test(targetId)) {
      throw new Error('Профиль Steam указан неверно.');
    }
    if (sourceId === targetId) {
      throw new Error('Источник и получатель должны быть разными аккаунтами.');
    }
    if (mode !== undefined && mode !== 'controls' && mode !== 'all')
      throw new Error('Неизвестный режим переноса.');
    return mode === undefined
      ? this.#store.transfer(sourceId, targetId)
      : this.#store.transfer(sourceId, targetId, mode);
  }
}
