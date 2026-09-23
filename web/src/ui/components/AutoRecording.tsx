import { useEffect, useState } from 'react';

export function AutoRecording(): React.JSX.Element | null {
  const desktop = window.kadroskopDesktop;
  const [state, setState] = useState<{ enabled: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const refresh = () => {
      void desktop
        .getAutoRecording()
        .then((value) => {
          if (active) setState(value);
        })
        .catch((error) => {
          if (active) setError(String(error));
        });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [desktop]);
  if (!desktop) return null;
  return (
    <section className="card">
      <label>
        <input
          type="checkbox"
          checked={state?.enabled ?? false}
          disabled={!state || busy}
          onChange={(event) => {
            setBusy(true);
            setError('');
            void desktop
              .setAutoRecording(event.target.checked)
              .then(setState)
              .catch((error) => setError(String(error)))
              .finally(() => setBusy(false));
          }}
        />{' '}
        Автоматически записывать при запуске Dota
      </label>
      <p>{state?.message ?? 'Загружаю настройки…'}</p>
      <p className="muted">
        Работает, пока Кадроскоп открыт или свёрнут в трей. Если Dota уже запущена, запись начнётся
        после включения. Сохранение — при выходе из игры, ручной остановке или через 4 часа. Windows
        может запросить права администратора.
      </p>
      <p className="muted">
        Храним до 20 автозаписей в пределах 2 ГБ: старые удаляются после сохранения новой. Последняя
        сохраняется целиком даже при превышении лимита. Ручные записи сохраняются. Выключение
        переключателя не останавливает текущую запись.
      </p>
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
