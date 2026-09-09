import { toConfigView } from '../adapters/http/config.view.ts';
import type { SessionStore } from '../application/ports/session-store.port.ts';
import {
  ManageGameConfig,
  type ConfigChangeRequest,
  type GameConfigState,
} from '../application/use-cases/manage-game-config.ts';
import type { MeasuredContext } from '../domain/gameconfig/config-analysis.ts';
import { FileGameConfigStore } from '../infrastructure/gameconfig/file-game-config.store.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';

/**
 * Конфиг игры: показать, поправить, заменить, удалить, вынести копию.
 *
 * Всё, что меняет файл, идёт через POST — и не только ради приличий: GET
 * ходит по ссылке из любого места, а удалять конфиг по ссылке нельзя.
 */
export function createConfigRoutes(
  sessions: SessionStore,
  /** Конфиг изменился: всё, что помнило его прежним, должно об этом узнать. */
  onChanged: () => void,
): readonly JsonRoute[] {
  const manage = new ManageGameConfig(new FileGameConfigStore(), () => lastMeasured(sessions));

  const changing = async (act: () => Promise<GameConfigState>): Promise<unknown> => {
    const state = await act();
    onChanged();
    return toConfigView(state);
  };

  return [
    {
      path: '/api/config',
      async handle() {
        return toConfigView(await manage.read());
      },
    },
    {
      path: '/api/config/apply',
      method: 'POST',
      handle: (_query, body) => changing(() => manage.apply(changesFrom(body))),
    },
    {
      path: '/api/config/replace',
      method: 'POST',
      handle: (_query, body) => changing(() => manage.replace(textFrom(body))),
    },
    {
      path: '/api/config/remove',
      method: 'POST',
      handle: () => changing(() => manage.remove()),
    },
    {
      path: '/api/config/export',
      method: 'POST',
      async handle() {
        return { path: await manage.copyToDesktop() };
      },
    },
  ];
}

/**
 * Что показала последняя запись.
 *
 * Без неё разбор конфига говорит вообще, с ней — про эту машину: снятый
 * потолок кадров безобиден там, где игра попадает в развёртку, и вреден там,
 * где не попадает. Записей нет — так и передаём, `null` вместо выдумки.
 */
async function lastMeasured(sessions: SessionStore): Promise<MeasuredContext> {
  try {
    const latest = (await sessions.list())[0];
    if (latest === undefined) return { pacingTimeShare: null, bottleneck: null };
    return { pacingTimeShare: latest.pacingTimeShare, bottleneck: latest.bottleneck };
  } catch {
    return { pacingTimeShare: null, bottleneck: null };
  }
}

function changesFrom(body: string): readonly ConfigChangeRequest[] {
  const parsed: unknown = parseJson(body);
  const raw = (parsed as { changes?: unknown }).changes;
  if (!Array.isArray(raw)) {
    throw new Error('Ожидался список правок: changes.');
  }

  return raw.map((entry: unknown) => {
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('У правки должно быть имя настройки.');
    }
    if (value !== null && typeof value !== 'string') {
      throw new Error(`Значение ${name} должно быть строкой или null.`);
    }
    return { name: name.trim(), value };
  });
}

function textFrom(body: string): string {
  const parsed: unknown = parseJson(body);
  const { text } = parsed as { text?: unknown };
  if (typeof text !== 'string') {
    throw new Error('Ожидалось поле text с содержимым конфига.');
  }
  return text;
}

function parseJson(body: string): object {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Тело запроса — не JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Тело запроса должно быть объектом.');
  }
  return parsed;
}
