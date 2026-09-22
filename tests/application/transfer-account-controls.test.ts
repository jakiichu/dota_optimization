import { describe, expect, it } from 'vitest';
import { TransferAccountControls } from '../../src/application/use-cases/transfer-account-controls.ts';
import type { AccountControlsStore } from '../../src/application/ports/account-controls.port.ts';

const store: AccountControlsStore = {
  list: async () => [],
  transfer: async () => { throw new Error('не должен вызываться'); },
};

describe('перенос управления между аккаунтами', () => {
  it('не принимает один аккаунт как источник и получателя', async () => {
    const useCase = new TransferAccountControls(store);
    await expect(useCase.transfer('42', '42')).rejects.toThrow('разными аккаунтами');
  });

  it('не пропускает путь вместо локального AccountID', async () => {
    const useCase = new TransferAccountControls(store);
    await expect(useCase.transfer('../42', '17')).rejects.toThrow('указан неверно');
  });
});
