import { TransferAccountControls } from '../application/use-cases/transfer-account-controls.ts';
import type { AccountControlsStore } from '../application/ports/account-controls.port.ts';
import { SteamAccountControlsStore } from '../infrastructure/steam/account-controls.store.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';

export function createAccountControlsRoutes(
  store: AccountControlsStore = new SteamAccountControlsStore(),
): readonly JsonRoute[] {
  const controls = new TransferAccountControls(store);
  return [
    {
      path: '/api/account-controls',
      async handle() { return { profiles: await controls.list() }; },
    },
    {
      path: '/api/account-controls/transfer',
      method: 'POST',
      async handle(_query, body) {
        const { sourceId, targetId } = requestFrom(body);
        return controls.transfer(sourceId, targetId);
      },
    },
  ];
}

function requestFrom(body: string): { sourceId: string; targetId: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new Error('Тело запроса — не JSON.'); }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Ожидался объект переноса.');
  const { sourceId, targetId } = parsed as { sourceId?: unknown; targetId?: unknown };
  if (typeof sourceId !== 'string' || typeof targetId !== 'string') {
    throw new Error('Нужно выбрать аккаунт-источник и аккаунт-получатель.');
  }
  return { sourceId, targetId };
}
