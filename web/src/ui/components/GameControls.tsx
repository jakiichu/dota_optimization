import { useState } from 'react';
import { useGameControl } from '../../application/use-game-control.ts';

const LABELS = {
  running: 'Dota запущена',
  stopped: 'Dota закрыта',
  starting: 'Запускаю Dota…',
  closing: 'Закрываю Dota…',
};

export function GameControls({ captureBlocked }: { captureBlocked: boolean }): React.JSX.Element {
  const { status, command } = useGameControl();
  const [confirmClose, setConfirmClose] = useState(false);
  const phase = status.data?.phase;
  const busy = command.isPending || phase === 'starting' || phase === 'closing';
  const disabled = captureBlocked || busy || status.isPending || status.isError;
  const error = command.error?.message ?? status.error?.message ?? status.data?.error;
  return (
    <section className="game-controls" aria-label="Управление Dota 2">
      <div className="game-controls-row">
        <span role="status">
          {status.isError ? 'Статус Dota недоступен' : phase ? LABELS[phase] : 'Проверяю Dota…'}
        </span>
        <div className="recommendation-actions">
          <button
            className="button"
            disabled={disabled || phase !== 'stopped'}
            onClick={() => {
              setConfirmClose(false);
              command.mutate('open');
            }}
          >
            Открыть Dota
          </button>
          <button
            className="button"
            disabled={disabled || phase !== 'running'}
            onClick={() => {
              command.reset();
              setConfirmClose(true);
            }}
          >
            Закрыть Dota
          </button>
        </div>
      </div>
      {captureBlocked && (
        <p className="muted">Управление игрой доступно после завершения записи.</p>
      )}
      {confirmClose && phase === 'running' && !disabled && (
        <div>
          <p>Закрыть Dota? Если идёт матч, вы покинете игру.</p>
          <div className="recommendation-actions">
            <button
              className="button"
              onClick={() => {
                setConfirmClose(false);
                command.mutate('close');
              }}
            >
              Да, закрыть
            </button>
            <button className="button" onClick={() => setConfirmClose(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
