import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  Audit,
  BenchmarkOptions,
  Capture,
  Comparison,
  ConfigEdit,
  FrameWindow,
  GameConfig,
  Hypothesis,
  RecommendationKind,
  ReplayRun,
  ReplayRunState,
  SessionSummary,
} from '../domain/models.ts';
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
  sessionWindow: (id: string, from: number, to: number) =>
    ['sessions', 'analysis', id, from, to] as const,
  config: ['config'] as const,
  benchmark: ['benchmark'] as const,
  hypotheses: ['hypotheses'] as const,
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
 * Гипотезы.
 *
 * Приговор считается на сервере при каждом чтении, поэтому кешировать его
 * надолго нельзя: новая запись может стать той самой «после», а пересчёт по
 * новым метрикам — изменить вердикт.
 */
const HYPOTHESES_STALE_MS = 30 * 1000;

export function useHypotheses(): UseQueryResult<readonly Hypothesis[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.hypotheses,
    queryFn: ({ signal }) => api.fetchHypotheses(signal),
    staleTime: HYPOTHESES_STALE_MS,
  });
}

export interface RecordHypothesis {
  readonly sessionId: string;
  readonly kind: RecommendationKind;
}

export function useHypothesisActions(): {
  readonly record: UseMutationResult<Hypothesis, Error, RecordHypothesis>;
  readonly settle: UseMutationResult<Hypothesis, Error, { id: string; afterSessionId: string }>;
  readonly forget: UseMutationResult<readonly Hypothesis[], Error, string>;
} {
  const api = useApi();
  const client = useQueryClient();
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: queryKeys.hypotheses });
  };

  return {
    record: useMutation({
      mutationFn: ({ sessionId, kind }: RecordHypothesis) =>
        api.recordHypothesis(sessionId, kind),
      onSuccess: refresh,
    }),
    settle: useMutation({
      mutationFn: ({ id, afterSessionId }: { id: string; afterSessionId: string }) =>
        api.settleHypothesis(id, afterSessionId),
      onSuccess: refresh,
    }),
    forget: useMutation({
      mutationFn: (id: string) => api.forgetHypothesis(id),
      onSuccess: (hypotheses) => client.setQueryData(queryKeys.hypotheses, hypotheses),
    }),
  };
}

/**
 * Эталонный прогон.
 *
 * Опрашивается на ходу: главное в нём — идёт ли сейчас игра, а это меняется без
 * нашего участия. Человек закрыл Dota — экран обязан сказать, что прогона
 * больше нет, иначе следующая запись будет помечена сценой, которой уже нет.
 */
const GAME_RUNNING_POLL_MS = 5000;

export function useBenchmark(): UseQueryResult<BenchmarkOptions> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.benchmark,
    queryFn: ({ signal }) => api.fetchBenchmark(signal),
    refetchInterval: GAME_RUNNING_POLL_MS,
  });
}

export function useLaunchReplayRun(): UseMutationResult<ReplayRunState, Error, ReplayRun> {
  const api = useApi();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (run: ReplayRun) => api.launchReplayRun(run),
    // Игра запускается не мгновенно, поэтому состояние всё равно перечитаем —
    // но ответ кладём сразу, чтобы шаги появились без ожидания.
    onSuccess: (state) => {
      client.setQueryData(queryKeys.benchmark, (previous: BenchmarkOptions | undefined) =>
        previous === undefined ? previous : { ...previous, state },
      );
      void client.invalidateQueries({ queryKey: queryKeys.benchmark });
    },
  });
}

/**
 * Конфиг игры.
 *
 * Кешируется коротко: файл лежит на диске и его правят снаружи — через
 * консоль игры, блокнот или другую машину. Показать вчерашнее содержимое
 * файла, который человек только что поменял руками, хуже, чем подождать.
 */
const CONFIG_STALE_MS = 15 * 1000;

export function useGameConfig(): UseQueryResult<GameConfig> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: ({ signal }) => api.fetchConfig(signal),
    staleTime: CONFIG_STALE_MS,
  });
}

/**
 * Правки конфига.
 *
 * Все четыре действия меняют файл на диске, поэтому после каждого сбрасывается
 * и аудит: правило про конфиг — часть аудита, и оставить его с прежним
 * вердиктом значило бы показывать человеку разбор файла, которого больше нет.
 */
export function useConfigMutations(): {
  readonly apply: UseMutationResult<GameConfig, Error, readonly ConfigEdit[]>;
  readonly replace: UseMutationResult<GameConfig, Error, string>;
  readonly remove: UseMutationResult<GameConfig, Error, void>;
  readonly exportToDesktop: UseMutationResult<string, Error, void>;
} {
  const api = useApi();
  const client = useQueryClient();

  const settle = (config: GameConfig): void => {
    client.setQueryData(queryKeys.config, config);
    void client.invalidateQueries({ queryKey: queryKeys.audit });
  };

  const apply = useMutation({
    mutationFn: (edits: readonly ConfigEdit[]) => api.applyConfigEdits(edits),
    onSuccess: settle,
  });
  const replace = useMutation({
    mutationFn: (text: string) => api.replaceConfig(text),
    onSuccess: settle,
  });
  const remove = useMutation({
    mutationFn: () => api.removeConfig(),
    onSuccess: settle,
  });
  // Копия на рабочий стол ничего не меняет — сбрасывать после неё нечего.
  const exportToDesktop = useMutation({ mutationFn: () => api.exportConfig() });

  return { apply, replace, remove, exportToDesktop };
}

/**
 * Запись кадров.
 *
 * Не запрос, а действие: она меняет состояние машины и длится минуту. Кешировать
 * её нельзя — повторный вызов должен записывать заново, а не отдавать старое.
 */
/**
 * Кусок записи для графика.
 *
 * Отдельный запрос, а не фильтрация на клиенте: часовая запись это сотня
 * мегабайт, и держать её в браузере целиком ради увеличения нельзя.
 */
export function useSessionWindow(
  id: string,
  window: FrameWindow | null,
): UseQueryResult<Capture> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.sessionWindow(id, window?.fromSeconds ?? 0, window?.toSeconds ?? 0),
    queryFn: ({ signal }) => api.analyzeSession(id, signal, window ?? undefined),
    enabled: id !== '' && window !== null,
    staleTime: ANALYSIS_STALE_MS,
  });
}

/** Досрочная остановка записи: ещё один запрос прав, о чём интерфейс и говорит. */
export function useStopCapture(): UseMutationResult<void, Error, void> {
  const api = useApi();
  return useMutation({ mutationFn: () => api.stopCapture() });
}

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
