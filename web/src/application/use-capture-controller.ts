import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './api-context.ts';
import { queryKeys, useRunCapture, useStopCapture } from './queries.ts';
import type { CaptureRequest } from './ports/kadroskop-api.port.ts';
import { usePageVisible } from './use-page-visible.ts';

/** Управление живёт в оболочке, после перезагрузки статус восстанавливает сервер. */
export function useCaptureController() {
  const api = useApi();
  const visible = usePageVisible();
  const client = useQueryClient();
  const capture = useRunCapture();
  const stop = useStopCapture();
  const status = useQuery({
    queryKey: ['capture-status'],
    queryFn: ({ signal }) => api.fetchCaptureStatus(signal),
    refetchInterval: visible ? 1000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const [pending, setPending] = useState<{ request: CaptureRequest; deadline: number } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [now, setNow] = useState(Date.now());
  const phase = status.data?.phase;
  const recording = capture.isPending || phase === 'recording' || phase === 'stopping' || phase === 'saving';
  const mutate = capture.mutate;
  useEffect(() => {
    if (pending === null && !recording) return undefined;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      const queued = pendingRef.current;
      if (queued !== null && time >= queued.deadline) {
        pendingRef.current = null;
        setPending(null);
        mutate(queued.request);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [mutate, pending, recording]);

  const completedId = status.data?.sessionId;
  useEffect(() => {
    if (!completedId) return;
    void client.invalidateQueries({ queryKey: queryKeys.sessions });
    void client.invalidateQueries({ queryKey: queryKeys.hypotheses });
  }, [completedId, client]);

  const startsIn = pending === null ? null : Math.max(0, Math.ceil((pending.deadline - now) / 1000));
  return {
    capture, stop, status, recording, startsIn,
    blocked: recording || pending !== null || status.isPending || status.isError,
    elapsedSeconds: status.data?.startedAt == null ? 0
      : Math.max(0, Math.floor((now - Date.parse(status.data.startedAt)) / 1000)),
    begin(request: CaptureRequest) {
      if (recording || pendingRef.current !== null || status.isPending || status.isError) return;
      capture.reset();
      stop.reset();
      const queued = { request, deadline: Date.now() + 5000 };
      setNow(Date.now());
      pendingRef.current = queued;
      setPending(queued);
    },
    cancelStart() { pendingRef.current = null; setPending(null); },
    stopRecording() {
      stop.mutate(undefined, { onSettled: () => { void status.refetch(); } });
    },
  };
}

export type CaptureController = ReturnType<typeof useCaptureController>;
