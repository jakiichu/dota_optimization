import { useState } from 'react';
import { useApi } from './api-context.ts';

export function useReportExport(): {
  readonly error: string | null;
  readonly pending: boolean;
  readonly path: string | null;
  readonly save: (html: string) => void;
} {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  return { error, pending, path, save: (html) => {
    setError(null);
    setPath(null);
    setPending(true);
    void api.exportReport(html)
      .then(setPath)
      .catch((failure: unknown) => setError(
        failure instanceof Error ? failure.message : 'Не удалось сохранить отчёт.',
      ))
      .finally(() => setPending(false));
  } };
}
