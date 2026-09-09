import { useState } from 'react';
import { useBenchmark, useLaunchReplayRun } from '../../application/queries.ts';
import type { BenchmarkOptions } from '../../domain/models.ts';

/**
 * Эталонный прогон: запустить игру с нужным повтором.
 *
 * Стоит над формой записи, потому что читается сверху вниз как один порядок
 * действий: задать сцену → запустить игру → записать. Разнеси это по разным
 * разделам — и человек снова начнёт записывать что попало, а потом сравнивать
 * несравнимое.
 *
 * Пока прогон идёт, форма записи не спрашивает сцену вовсе: приложение знает её
 * точно, потому что само положило файл повтора и тик в команды запуска игры.
 */
export function ReplayRunPanel(): React.JSX.Element {
  const benchmark = useBenchmark();
  const launch = useLaunchReplayRun();

  const [replayFile, setReplayFile] = useState('');
  const [tick, setTick] = useState('');

  if (benchmark.isPending) {
    return (
      <div className="card">
        <div className="muted">Ищу Steam и повторы…</div>
      </div>
    );
  }
  if (benchmark.isError) {
    return (
      <div className="card">
        <div className="notice error">{benchmark.error.message}</div>
      </div>
    );
  }

  const options = benchmark.data;
  const chosen = replayFile === '' ? (options.replays[0]?.name ?? '') : replayFile;
  const parsedTick = Number.parseInt(tick, 10);

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Эталонный прогон</span>
        <span className="card-note">
          {options.state.gameRunning ? 'Dota запущена' : 'Dota закрыта'}
        </span>
      </div>

      <div className="muted">
        Повтор проигрывает одни и те же кадры: те же герои, те же заклинания, та же
        нагрузка. Это единственный способ сравнить настройки, а не сцены.
      </div>

      <Obstacles options={options} />

      {options.state.current !== null ? (
        <RunningNow options={options} />
      ) : (
        options.ready &&
        options.replays.length > 0 && (
          <>
            <div className="capture-form" style={{ marginTop: 16 }}>
              <label>
                <span className="metric-label">повтор</span>
                <select
                  className="input"
                  value={chosen}
                  onChange={(event) => setReplayFile(event.target.value)}
                  disabled={launch.isPending}
                >
                  {options.replays.map((replay) => (
                    <option key={replay.name} value={replay.name}>
                      {replay.name} · {mib(replay.sizeBytes)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="metric-label">тик</span>
                <input
                  className="input"
                  value={tick}
                  inputMode="numeric"
                  placeholder="с начала"
                  onChange={(event) => setTick(event.target.value)}
                  disabled={launch.isPending}
                />
              </label>
              <button
                type="button"
                className="button primary"
                disabled={launch.isPending || options.state.gameRunning}
                onClick={() =>
                  launch.mutate({
                    replayFile: chosen,
                    startTick: Number.isFinite(parsedTick) ? parsedTick : null,
                    label: '',
                  })
                }
              >
                {launch.isPending ? 'Запускаю…' : 'Запустить Dota с этим повтором'}
              </button>
            </div>

            {options.state.gameRunning && (
              <div className="notice">
                Dota уже запущена, а команды прогона выполняются только при старте
                игры. Закройте её — иначе повтор не загрузится, а мы решим, что
                загрузился.
              </div>
            )}
            {launch.isError && <div className="notice error">{launch.error.message}</div>}

            <div className="muted" style={{ marginTop: 8 }}>
              Тик задаёт место в матче. Не знаете нужный — оставьте пустым, повтор
              пойдёт с начала; главное, чтобы во всех сравниваемых записях он был
              одинаковым.
            </div>
          </>
        )
      )}
    </div>
  );
}

function Obstacles({ options }: { options: BenchmarkOptions }): React.JSX.Element | null {
  if (options.obstacles.length === 0) return null;

  return (
    <div className="notice" style={{ marginTop: 12 }}>
      <ul className="steps">
        {options.obstacles.map((obstacle) => (
          <li key={obstacle}>{obstacle}</li>
        ))}
      </ul>
    </div>
  );
}

/** Что показывать, пока прогон идёт: шаги и чем помечена будет запись. */
function RunningNow({ options }: { options: BenchmarkOptions }): React.JSX.Element {
  const run = options.state.current;
  if (run === null) return <></>;

  return (
    <div className="run-active">
      <div className="run-scene">
        Запись будет помечена сценой: повтор <code>{run.replayFile}</code>
        {run.startTick !== null && (
          <>
            , тик <code>{run.startTick}</code>
          </>
        )}
      </div>

      <ol className="steps">
        {options.state.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {options.state.manualSeek !== null && (
        <div className="muted">
          Команда для консоли, если игра не остановилась сама:{' '}
          <code>{options.state.manualSeek}</code>
        </div>
      )}
      {options.state.configPath !== null && (
        <div className="muted">
          Команды записаны в <code>{options.state.configPath}</code>
        </div>
      )}
    </div>
  );
}

const BYTES_IN_MIB = 1024 * 1024;

function mib(bytes: number): string {
  return `${Math.round(bytes / BYTES_IN_MIB)} МиБ`;
}
