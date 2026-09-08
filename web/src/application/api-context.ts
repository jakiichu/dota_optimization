import { createContext, useContext } from 'react';
import type { FramelossApi } from './ports/frameloss-api.port.ts';

/**
 * Откуда экраны берут реализацию доступа к данным.
 *
 * Контекст объявлен в слое сценариев, а подставляется в него конкретная
 * реализация только в точке сборки приложения. Поэтому здесь нет и не должно
 * быть импорта из инфраструктуры.
 */
const ApiContext = createContext<FramelossApi | null>(null);

export const ApiProvider = ApiContext.Provider;

export function useApi(): FramelossApi {
  const api = useContext(ApiContext);
  if (api === null) {
    throw new Error('ApiProvider не установлен: приложение собрано неправильно.');
  }
  return api;
}
