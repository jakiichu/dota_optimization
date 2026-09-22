import { describe, expect, it, vi } from 'vitest';
import type { AccountControlsStore } from '../../src/application/ports/account-controls.port.ts';
import { createAccountControlsRoutes } from '../../src/main/account-controls-routes.ts';

const profile = {
  id: '101', label: 'Первый', mostRecent: true, hasControls: true,
  sizeBytes: 42, modifiedAt: '2026-09-13T10:00:00.000Z',
};

describe('маршруты переноса управления', () => {
  it('отдают найденные профили', async () => {
    const store: AccountControlsStore = {
      list: async () => [profile],
      transfer: async () => { throw new Error('не вызывается'); },
    };
    const route = createAccountControlsRoutes(store).find((item) => item.path === '/api/account-controls')!;

    await expect(route.handle(new URLSearchParams(), '')).resolves.toEqual({ profiles: [profile] });
  });

  it('передают только выбранные идентификаторы в сценарий', async () => {
    const transfer = vi.fn(async () => ({
      source: profile, target: { ...profile, id: '202', label: 'Второй' },
      backupPath: null, transferredBytes: 42,
    }));
    const store: AccountControlsStore = { list: async () => [], transfer };
    const route = createAccountControlsRoutes(store).find((item) => item.path.endsWith('/transfer'))!;

    await route.handle(new URLSearchParams(), JSON.stringify({ sourceId: '101', targetId: '202' }));

    expect(transfer).toHaveBeenCalledWith('101', '202');
  });

  it('отклоняют неполный запрос', async () => {
    const store: AccountControlsStore = {
      list: async () => [], transfer: async () => { throw new Error('не вызывается'); },
    };
    const route = createAccountControlsRoutes(store).find((item) => item.path.endsWith('/transfer'))!;

    await expect(route.handle(new URLSearchParams(), '{}')).rejects.toThrow('Нужно выбрать');
  });
});
