import { useState } from 'react';
import { useBenchmark, useLaunchReplayRun } from '../../application/queries.ts';
import type { BenchmarkOptions, ReplayFile } from '../../domain/models.ts';
import {
  clock,
  replayLength,
  secondsToTick,
  tickToSeconds,
  tickWithinReplay,
} from '../../domain/replay-time.ts';

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

/** Готовые отметки времени: попасть в замес наугад по тикам невозможно. */
const PRESET_MINUTES = [10, 20, 30, 40];

const SECONDS_IN_MINUTE = 60;

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
  const chosenName = replayFile === '' ? (options.replays[0]?.name ?? '') : replayFile;
  const chosen = options.replays.find((replay) => replay.name === chosenName);
  const parsedTick = Number.parseInt(tick, 10);
  const validTick = Number.isFinite(parsedTick) && parsedTick >= 0;

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
                  value={chosenName}
                  onChange={(event) => setReplayFile(event.target.value)}
                  disabled={launch.isPending}
                >
                  {options.replays.map((replay) => (
                    <option key={replay.name} value={replay.name}>
                      {describeReplay(replay)}
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
                    replayFile: chosenName,
                    startTick: validTick ? parsedTick : null,
                    label: '',
                  })
                }
              >
                {launch.isPending ? 'Запускаю…' : 'Запустить Dota с этим повтором'}
              </button>
            </div>

            {/* Тик — это тридцатая доля секунды, и вслепую он не выбирается. */}
            <TickHint replay={chosen} tick={validTick ? parsedTick : null} />

            <div className="tick-presets">
              <span className="muted">с минуты:</span>
              {PRESET_MINUTES.filter((minutes) =>
                withinReplay(chosen, minutes * SECONDS_IN_MINUTE),
              ).map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="chip"
                  onClick={() =>
                    setTick(String(secondsToTick(chosen, minutes * SECONDS_IN_MINUTE)))
                  }
                >
                  {minutes} мин
                </button>
              ))}
              <button type="button" className="chip" onClick={() => setTick('')}>
                с начала
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
          </>
        )
      )}
    </div>
  );
}

/**
 * Что значит введённый тик.
 *
 * Главное здесь — предупреждение про начало повтора. Первые минуты это драфт и
 * загрузка: там нет ни героев, ни заклинаний, и мерить нечего. Человек,
 * поставивший маленький тик, будет смотреть на неподвижный экран и думать, что
 * инструмент сломался.
 */
function TickHint({
  replay,
  tick,
}: {
  replay: ReplayFile | undefined;
  tick: number | null;
}): React.JSX.Element {
  if (tick === null) {
    return (
      <div className="muted tick-hint">
        Тик не задан — повтор пойдёт с начала, то есть со стадии выбора героев.
      </div>
    );
  }

  const seconds = tickToSeconds(replay, tick);
  if (!tickWithinReplay(replay, tick)) {
    return (
      <div className="tick-hint warn">
        Такого тика в повторе нет: он длится {replay?.ticks} тиков (
        {replayLength(replay)}).
      </div>
    );
  }

  return (
    <div className="tick-hint">
      <span className="muted">
        {tick} тиков — это <b>{clock(seconds)}</b> от начала записи повтора
        {replayLength(replay) !== null && <> из {replayLength(replay)}</>}.
      </span>
      {seconds < EARLY_GAME_SECONDS && (
        <span className="warn">
          Это ещё выбор героев и раскладка: нагрузки там почти нет, мерить нечего.
        </span>
      )}
    </div>
  );
}

/** До этой отметки в повторе идут драфт, загрузка и пустая карта до горна. */
const EARLY_GAME_SECONDS = 8 * SECONDS_IN_MINUTE;

function withinReplay(replay: ReplayFile | undefined, seconds: number): boolean {
  return replay?.durationSeconds == null || seconds <= replay.durationSeconds;
}

function describeReplay(replay: ReplayFile): string {
  const length = replayLength(replay);
  return length === null
    ? `${replay.name} · ${mib(replay.sizeBytes)}`
    : `${replay.name} · ${length}`;
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
