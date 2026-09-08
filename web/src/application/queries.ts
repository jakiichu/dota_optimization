import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { Audit, Capture, Comparison, SessionSummary } from '../domain/models.ts';
import { useApi } from './api-context.ts';
import type { CaptureRequest } from './ports/frameloss-api.port.ts';

/**
 * Чтение данных с кешем.
 *
 * Кеш здесь ради одной вещи: переключение раздела не должно превращаться в
 * ожидание. Аудит собирается через PowerShell несколько секунд, и платить за
 * это каждый раз, когда человек вернулся на вкладку, незачем.
 */

/** Ключи кеша в одном месте: разъехавшиеся ключи — это молча протухший кеш. */
export const queryKeys = {
  audit: ['audit'] as const,
  sessions: ['sessions'] as const,
  comparison: (beforeId: string, afterId: string) =>
    ['sessions', 'comparison', beforeId, afterId] as const,
  session: (id: string) => ['sessions', 'analysis', id] as const,
};

/**
 * Аудит устаревает не сразу: состав железа и настройки за минуту не меняются,
 * а сбор стоит секунд.
 */
const AUDIT_STALE_MS = 5 * 60 * 1000;

/** Список записей меняется только после новой записи — её мы и так сбросим. */
const SESSIONS_STALE_MS = 60 * 1000;

/** Разбор сохранённой записи не меняется вовсе, пока не сменились метрики. */
const ANALYSIS_STALE_MS = 10 * 60 * 1000;

export function useAudit(): UseQueryResult<Audit> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.audit,
    queryFn: ({ signal }) => api.fetchAudit(signal),
    staleTime: AUDIT_STALE_MS,
  });
}

export function useSessions(): UseQueryResult<readonly SessionSummary[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: ({ signal }) => api.fetchSessions(signal),
    staleTime: SESSIONS_STALE_MS,
  });
}

export function useComparison(
  beforeId: string,
  afterId: string,
): UseQueryResult<Comparison> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.comparison(beforeId, afterId),
    queryFn: ({ signal }) => api.fetchComparison(beforeId, afterId, signal),
    // Пока не выбраны обе записи, спрашивать нечего.
    enabled: beforeId !== '' && afterId !== '' && beforeId !== afterId,
    staleTime: ANALYSIS_STALE_MS,
  });
}

export function useSessionAnalysis(id: string | null): UseQueryResult<Capture> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.session(id ?? ''),
    queryFn: ({ signal }) => api.analyzeSession(id ?? '', signal),
    enabled: id !== null && id !== '',
    staleTime: ANALYSIS_STALE_MS,
  });
}

/**
 * Запись кадров.
 *
 * Не запрос, а действие: она меняет состояние машины и длится минуту. Кешировать
 * её нельзя — повторный вызов должен записывать заново, а не отдавать старое.
 */
export function useRunCapture(): UseMutationResult<Capture, Error, CaptureRequest> {
  const api = useApi();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (request: CaptureRequest) =>
      api.runCapture(request, new AbortController().signal),
    onSuccess: (capture) => {
      // Новая запись появилась в списке, а её разбор уже у нас на руках —
      // кладём сразу, чтобы открытие записи не стоило ещё одного запроса.
      void client.invalidateQueries({ queryKey: queryKeys.sessions });
      client.setQueryData(queryKeys.session(capture.sessionId), capture);
    },
  });
}
