import type { CaptureController } from '../../application/use-capture-controller.ts';

export function CaptureStatusBar({ recorder, onOpen }: {
  recorder: CaptureController;
  onOpen: () => void;
}): React.JSX.Element | null {
  const { status, recording, startsIn, stop, capture, elapsedSeconds } = recorder;
  const state = status.data;
  if (!recording && startsIn === null && !status.isError && !capture.isError && state?.phase !== 'failed' && state?.phase !== 'completed') return null;
  const stopping = stop.isPending || state?.phase === 'stopping';
  return (
    <div className="card capture-status-bar" aria-label="Состояние записи">
      <div role="status">
        <strong>{startsIn !== null ? `Запись начнётся через ${startsIn} с — вернитесь в игру`
          : state?.phase === 'saving' ? 'Сохраняю и разбираю запись…'
          : stopping ? 'Останавливаю запись…'
          : recording ? state?.phase === 'recording'
            ? `Запись идёт · ${elapsedSeconds} с с момента запуска` : 'Запускаю запись…'
          : state?.phase === 'completed' ? 'Запись сохранена'
          : state?.phase === 'failed' || capture.isError ? 'Запись не завершена' : 'Статус записи недоступен'}</strong>
        {recording && <div className="muted">{state?.label || state?.processName} · {state?.wholeGame ? 'до выхода из игры' : 'Можно переходить между разделами'}</div>}
        {status.isError && <div className="notice error">Не удалось проверить статус. Переподключаюсь…</div>}
        {state?.phase === 'failed' && <div className="notice error">{state.error}</div>}
        {capture.isError && !recording && state?.phase !== 'failed' && <div className="notice error">{capture.error.message}</div>}
        {stop.isError && <div className="notice error">{stop.error.message}</div>}
      </div>
      <div className="capture-status-actions">
        {startsIn !== null && <button className="button" onClick={recorder.cancelStart}>Отменить старт</button>}
        {recording && <button className="button" disabled={stopping || state?.phase !== 'recording'} onClick={recorder.stopRecording}>Остановить</button>}
        <button className="chip" onClick={onOpen}>Открыть записи</button>
      </div>
    </div>
  );
}
