import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './application/api-context.ts';
import { HttpFramelossApi } from './infrastructure/http-frameloss.api.ts';
import { AppShell } from './ui/AppShell.tsx';
import './styles.css';

/**
 * Точка сборки приложения: единственное место, где слои встречаются.
 *
 * Экраны знают только про порт доступа к данным, а какая за ним реализация —
 * решается здесь.
 */
const api = new HttpFramelossApi();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Приложение локальное: данные берутся с этой же машины, и повторять
      // запрос при каждом возврате в окно незачем.
      refetchOnWindowFocus: false,
      // Сбор данных идёт через PowerShell и внешние программы; если он упал,
      // он упадёт и со второго раза, а человек будет ждать вдвое дольше.
      retry: false,
    },
  },
});

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Не найден корневой элемент #root.');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <AppShell />
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
