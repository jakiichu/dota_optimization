import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './api-context.ts';
import { usePageVisible } from './use-page-visible.ts';

export function useGameControl() {
  const api = useApi();
  const visible = usePageVisible();
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ['game-status'],
    queryFn: ({ signal }) => api.fetchGameStatus(signal),
    refetchInterval: visible ? 3000 : false,
    retry: false,
  });
  const command = useMutation({
    mutationFn: (action: 'open' | 'close') => api.controlGame(action),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['game-status'] });
      void client.invalidateQueries({ queryKey: ['benchmark'] });
      void client.invalidateQueries({ queryKey: ['capture-readiness'] });
    },
  });
  return { status, command };
}
