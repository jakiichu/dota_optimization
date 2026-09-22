import type {
  AccountControlsStore,
  ControlTransferResult,
  SteamControlProfile,
} from '../ports/account-controls.port.ts';

/** Переносит только персональную раскладку Dota между локальными Steam-профилями. */
export class TransferAccountControls {
  readonly #store: AccountControlsStore;

  constructor(store: AccountControlsStore) {
    this.#store = store;
  }

  list(): Promise<readonly SteamControlProfile[]> {
    return this.#store.list();
  }

  async transfer(sourceId: string, targetId: string): Promise<ControlTransferResult> {
    if (!/^\d+$/.test(sourceId) || !/^\d+$/.test(targetId)) {
      throw new Error('Профиль Steam указан неверно.');
    }
    if (sourceId === targetId) {
      throw new Error('Источник и получатель должны быть разными аккаунтами.');
    }
    return this.#store.transfer(sourceId, targetId);
  }
}
