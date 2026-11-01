import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../application/queries.ts';

export function SessionStorage(): React.JSX.Element | null {
  const desktop = window.kadroskopDesktop;
  const client = useQueryClient();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void desktop
      ?.sessionsFolder()
      .then((value) => {
        if (active) setPath(value);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [desktop]);
  if (!desktop) return null;
  return (
    <section className="card">
      <h2 className="card-title">Общая история записей</h2>
      <p className="muted">
        Новые версии используют одну папку. Для записей из старой сборки выберите её папку sessions.
        Файлы копируются; оригиналы остаются на месте.
      </p>
      <p>
        <code style={{ overflowWrap: 'anywhere' }}>{path}</code>
      </p>
      <div className="recommendation-actions">
        <button
          className="button"
          onClick={() => {
            void desktop.openSessionsFolder().catch((error) => setError(String(error)));
          }}
        >
          Открыть папку
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            setMessage('');
            void desktop
              .importSessions()
              .then(async (result) => {
                if (!result) return;
                setMessage(
                  `Добавлено: ${result.imported}. Уже есть: ${result.skipped}. Не удалось импортировать: ${result.rejected}.`,
                );
                if (result.errors.length) setError(result.errors.join('\n'));
                await client.invalidateQueries({ queryKey: queryKeys.sessions });
              })
              .catch((error) => setError(String(error)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Импортирую…' : 'Импортировать старые записи'}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <div className="notice error" style={{ whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}
    </section>
  );
}
