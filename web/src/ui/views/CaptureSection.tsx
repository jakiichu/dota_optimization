import { useEffect, useRef, useState } from 'react';
import {
  useBenchmark,
  useRunCapture,
  useSessionAnalysis,
  useSessions,
  useSessionWindow,
  useStopCapture,
} from '../../application/queries.ts';
import type { Capture, ConfigChange, CpuLoad, FrameWindow } from '../../domain/models.ts';
import { BOTTLENECK_COLOR, BOTTLENECK_LABEL } from '../../domain/presentation.ts';
import { dateTime, ms, seconds } from '../../domain/formatting.ts';
import { CorrelationPanel } from '../components/CorrelationPanel.tsx';
import { FrameTimeChart } from '../components/FrameTimeChart.tsx';
import { PacingPanel } from '../components/PacingPanel.tsx';
import { RecommendationPanel } from '../components/RecommendationPanel.tsx';
import { ReplayRunPanel } from '../components/ReplayRunPanel.tsx';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from '../components/States.tsx';

const DEFAULT_PROCESS = 'dota2.exe';

/**
 * Длительности записи.
 *
 * Тридцати секунд не хватает: p99.9 при шестидесяти кадрах — это второй худший
 * кадр из 1800, то есть одна случайная загрузка текстуры. Числа начинают
 * значить обещанное на минутах, а не на секундах.
 */
const DURATIONS = [30, 60, 120, 300, 600] as const;

/** Значение в списке, означающее «пиши, пока идёт игра». */
const WHOLE_GAME = 0;

/**
 * Сколько ждём после нажатия, прежде чем начать писать.
 *
 * Не украшение. Нажимают кнопку в этом окне, а мерить надо игру — и в
 * полноэкранной Dota «переключиться в окно» значит «свернуть игру». Свёрнутая
 * Dota рисует иначе, а само переключение туда-сюда даёт всплески времени кадра,
 * которые запись честно зачтёт в статтеры. Пять секунд — чтобы успеть вернуться.
 */
const RECORDING_STARTS_IN = 5;

export function CaptureSection({
  onOpenInConfig,
}: {
  /** Уйти в редактор конфига с подставленным изменением из рекомендации. */
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element {
  const [processName, setProcessName] = useState(DEFAULT_PROCESS);
  const [durationSeconds, setDurationSeconds] = useState<number>(60);
  // Подпись нужна, чтобы через полчаса отличить «до HAGS» от «после».
  const [label, setLabel] = useState('');

  const capture = useRunCapture();
  const stop = useStopCapture();
  const benchmark = useBenchmark();
  const runActive = benchmark.data?.state.current != null;
  // Сохранённая запись, которую открыли посмотреть. Новая запись эту замену
  // отменяет: смотреть старую, когда только что сделали свежую, незачем.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const opened = useSessionAnalysis(openedId);
  const shownCapture = capture.data ?? opened.data;
  const wholeGame = durationSeconds === WHOLE_GAME;
  // Обратный отсчёт врал бы при записи целой игры: её длину мы не знаем.
  const remaining = useCountdown(capture.isPending && !wholeGame ? durationSeconds : null);
  const delayed = useDelayedStart(() =>
    capture.mutate({
      processName,
      seconds: wholeGame ? 0 : durationSeconds,
      label,
      wholeGame,
    }),
  );

  return (
    <>
      <SectionHeader
        title="Запись кадров"
        subtitle="сколько длится каждый кадр и почему иногда дольше обычного"
      />

      {/* Сцена задаётся до записи, а не описывается после: порядок на экране
          повторяет порядок действий. */}
      <ReplayRunPanel
        recorder={{
          recording: capture.isPending,
          startsIn: delayed.startsIn,
          onRecord: delayed.begin,
        }}
      />

      <div className="capture-form">
        <label>
          <span className="metric-label">процесс</span>
          <input
            className="input"
            value={processName}
            onChange={(event) => setProcessName(event.target.value)}
            disabled={capture.isPending}
          />
        </label>
        <label>
          <span className="metric-label">длительность</span>
          <select
            className="input"
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(Number(event.target.value))}
            disabled={capture.isPending}
          >
            {DURATIONS.map((value) => (
              <option key={value} value={value}>
                {value} с
              </option>
            ))}
            <option value={WHOLE_GAME}>вся игра</option>
          </select>
        </label>
        <label>
          <span className="metric-label">подпись</span>
          <input
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="например, до отключения MPO"
            disabled={capture.isPending}
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={capture.isPending || delayed.startsIn !== null}
          onClick={delayed.begin}
        >
          {delayed.startsIn !== null
            ? `Вернитесь в игру… ${delayed.startsIn}`
            : capture.isPending
              ? wholeGame
                ? 'Пишу, пока идёт игра…'
                : `Записываю… ${Math.max(remaining ?? 0, 0)} с`
              : runActive
                ? 'Записать прогон'
                : 'Записать'}
        </button>

        {capture.isPending && (
          <button
            type="button"
            className="button"
            disabled={stop.isPending || stop.isSuccess}
            onClick={() => stop.mutate()}
          >
            {stop.isSuccess ? 'Останавливаю…' : 'Остановить'}
          </button>
        )}
      </div>

      {/* Молча ждать пять секунд нельзя: человек решит, что кнопка не нажалась,
          и нажмёт ещё раз. */}
      {delayed.startsIn !== null && (
        <EmptyState>
          Запись начнётся через {delayed.startsIn} с — переключитесь в игру. В
          полноэкранной Dota это окно поверх неё значит, что игра свёрнута, а
          свёрнутая игра рисует иначе: и кадры другие, и переключение туда-сюда само
          по себе даст всплески, которые запись зачтёт в статтеры.
        </EmptyState>
      )}

      {capture.isPending && (
        <EmptyState>
          Игра должна быть запущена и рисовать. PresentMon требует прав администратора —
          если появился запрос UAC, подтвердите его.
          {wholeGame && ' Запись остановится сама, когда вы выйдете из игры.'}
          {' Остановка вручную попросит права ещё раз: своего процесса у записи нет,'}
          {' и погасить её может только второй экземпляр с теми же правами.'}
        </EmptyState>
      )}
      {stop.isError && <ErrorState message={stop.error.message} />}

      {capture.isError && <ErrorState message={capture.error.message} />}

      <SavedCaptures
        openedId={openedId}
        onOpen={(id) => {
          capture.reset();
          setOpenedId(id);
        }}
      />

      {opened.isFetching && openedId !== null && <LoadingState what="Читаю запись…" />}
      {opened.isError && <ErrorState message={opened.error.message} />}
      {shownCapture !== undefined && (
        <CaptureReport capture={shownCapture} onOpenInConfig={onOpenInConfig} />
      )}
    </>
  );
}

/**
 * Сохранённые записи.
 *
 * Без этого списка запись можно было увидеть только сразу после её окончания:
 * закрыл приложение — и часовой матч остался лежать файлом, до которого не
 * добраться иначе как через консоль. Улики на графике, ритм, узкое место — всё
 * это переставало существовать через минуту после замера.
 */
function SavedCaptures({
  openedId,
  onOpen,
}: {
  openedId: string | null;
  onOpen: (id: string) => void;
}): React.JSX.Element | null {
  const sessions = useSessions();
  if (sessions.data === undefined || sessions.data.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Сохранённые записи</span>
        <span className="card-note">{sessions.data.length}</span>
      </div>
      <div className="saved-list">
        {sessions.data.map((session) => (
          <button
            key={session.id}
            type="button"
            className="saved-item"
            aria-current={session.id === openedId}
            onClick={() => onOpen(session.id)}
          >
            <span className="saved-label">{session.label}</span>
            <span className="muted">{dateTime(session.capturedAt)}</span>
            <span className="muted">{seconds(session.durationSeconds, 0)}</span>
            <span className="muted">{session.averageFps.toFixed(0)} FPS</span>
            <span className="muted">{session.stutterCount} статтеров</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Обратный отсчёт до конца записи.
 *
 * Чисто клиентский: PresentMon о прогрессе не сообщает, но длительность мы
 * задали сами, так что показать её честно можно.
 */
/**
 * Отложенный старт: нажали — досчитали — начали.
 *
 * Отсчёт живёт здесь, а не в кнопке, потому что кнопок две: одна в форме, вторая
 * в панели прогона. Обе показывают один и тот же отсчёт и одну и ту же запись —
 * иначе человек нажмёт в одном месте, а «Записываю…» зажжётся в другом.
 */
function useDelayedStart(begin: () => void): {
  readonly startsIn: number | null;
  readonly begin: () => void;
} {
  const [startsIn, setStartsIn] = useState<number | null>(null);
  // Ссылка, а не значение: таймер заводится один раз, а `begin` пересоздаётся
  // на каждом рендере вместе с полями формы.
  const latest = useRef(begin);
  latest.current = begin;

  useEffect(() => {
    if (startsIn === null) return undefined;
    if (startsIn === 0) {
      setStartsIn(null);
      latest.current();
      return undefined;
    }
    const timer = setTimeout(() => setStartsIn((value) => (value ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [startsIn]);

  return {
    startsIn,
    begin: () => setStartsIn((running) => (running === null ? RECORDING_STARTS_IN : running)),
  };
}

function useCountdown(totalSeconds: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (totalSeconds === null) {
      setRemaining(null);
      return undefined;
    }
    setRemaining(totalSeconds);
    const timer = setInterval(() => {
      setRemaining((value) => (value === null ? null : Math.max(value - 1, 0)));
    }, 1000);
    return () => clearInterval(timer);
  }, [totalSeconds]);

  return remaining;
}

function CaptureReport({
  capture,
  onOpenInConfig,
}: {
  capture: Capture;
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element {
  // Увеличение: приблизив кусок часовой записи, человек должен увидеть его
  // кадр за кадром, а не ту же огибающую крупнее. Кадры за окном лежат на
  // сервере — держать сотню мегабайт в браузере ради этого нельзя.
  const [window, setWindow] = useState<FrameWindow | null>(null);
  const zoomed = useSessionWindow(capture.sessionId, window);
  const shown = zoomed.data?.series ?? capture.series;

  if (capture.frameCount === 0) {
    return (
      <EmptyState>
        Кадров не записано: процесс {capture.application} не рисовал в это время.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">{capture.application}</span>
          <span className="card-note">
            {capture.frameCount} кадров за {seconds(capture.durationSeconds)}
          </span>
        </div>
        <FrameTimeChart
          series={shown}
          onZoom={(fromSeconds, toSeconds) => setWindow({ fromSeconds, toSeconds })}
        />
        <ChartNote
          series={shown}
          zooming={zoomed.isFetching}
          windowed={window !== null}
          onReset={() => setWindow(null)}
        />
      </div>

      <div className="card">
        <div className="metrics">
          <Metric label="средний FPS" value={capture.averageFps.toFixed(1)} />
          <Metric label="медиана" value={ms(capture.frameTime.p50)} />
          <Metric label="p95" value={ms(capture.frameTime.p95)} />
          <Metric label="p99" value={ms(capture.frameTime.p99)} />
          <Metric label="p99.9" value={ms(capture.frameTime.p999)} />
          {capture.inputLatency !== null && (
            <Metric label="инпут-лаг p99" value={ms(capture.inputLatency.p99)} />
          )}
          <Metric
            label="статтеры"
            value={`${capture.stutterCount} (${capture.stuttersPerMinute.toFixed(1)}/мин)`}
          />
        </div>
        <div
          className="verdict"
          style={{ color: BOTTLENECK_COLOR[capture.bottleneck.kind] }}
        >
          {BOTTLENECK_LABEL[capture.bottleneck.kind]}
        </div>
        <div className="muted">{capture.bottleneck.explanation}</div>
      </div>

      <CpuPanel load={capture.cpuLoad} />

      <PacingPanel pacing={capture.pacing} />

      {/* Постоянная нагрузка стоит показать и без единого рывка: она отвечает
          на «что вообще крутилось», а не на «отчего дёрнулось». */}
      {(capture.stutterCount > 0 || capture.background.length > 0) && (
        <CorrelationPanel
          correlation={capture.correlation}
          stutterCount={capture.stutterCount}
          sensorSampleCount={capture.sensorSampleCount}
          background={capture.background}
        />
      )}

      {capture.network.measured && <NetworkPanel capture={capture} />}

      {/* Рекомендации последними: сначала числа, потом выводы из них. Обратный
          порядок читается как советы, к которым для солидности приложили графики. */}
      <RecommendationPanel
        recommendations={capture.recommendations}
        sessionId={capture.sessionId}
        onOpenInConfig={onOpenInConfig}
      />
    </>
  );
}

/**
 * Что было с процессором.
 *
 * Рядом с узким местом, потому что отвечает на следующий вопрос: «упор в
 * процессор» верен, но не говорит, добавлять ядер или искать, почему они
 * сбрасывают частоты. Ответы разные, и путать их дорого.
 */
function CpuPanel({ load }: { load: CpuLoad }): React.JSX.Element | null {
  if (!load.measured) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Процессор</span>
        {load.threadCount !== null && (
          <span className="card-note">{load.threadCount} потоков</span>
        )}
      </div>

      <div className="metrics">
        {load.busyThreads !== null && load.threadCount !== null && (
          <Metric
            label="занято потоков"
            value={`${load.busyThreads} из ${load.threadCount}`}
          />
        )}
        {load.utilizationPercent !== null && (
          <Metric label="загрузка" value={`${load.utilizationPercent.toFixed(0)} %`} />
        )}
        {load.performancePercent !== null && (
          <Metric
            label="частота от базовой"
            value={`${load.performancePercent.toFixed(0)} %`}
          />
        )}
        {load.lowestPerformancePercent !== null && (
          <Metric
            label="самый низкий провал"
            value={`${load.lowestPerformancePercent.toFixed(0)} %`}
          />
        )}
      </div>

      <div
        className="verdict"
        style={{
          color: load.throttled
            ? 'var(--critical)'
            : load.singleThreadBound
              ? 'var(--warning)'
              : 'var(--muted)',
        }}
      >
        {/* Причину ставим прямо в вердикт: «сбрасывал частоты» — наблюдение,
            «упёрся в предел мощности» — ответ, и это разные строки для того,
            кто читает. */}
        {load.throttled
          ? load.throttleReasons.length > 0
            ? `Процессор упирался в ${load.throttleReasons.join(', ')}`
            : 'Процессор сбрасывал частоты'
          : load.singleThreadBound
            ? 'Упор в скорость одного ядра'
            : 'Ничего необычного'}
      </div>
      <div className="muted">{load.summary}</div>
    </div>
  );
}

/**
 * Сеть отдельной карточкой, а не среди улик по кадрам: она не удлиняет кадр,
 * но даёт на экране такой же рывок.
 */
function NetworkPanel({ capture }: { capture: Capture }): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Сеть</span>
      </div>
      <div className="muted">{capture.network.summary}</div>
      <table className="table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>узел</th>
            <th>задержка</th>
            <th>дрожание</th>
            <th>потери</th>
          </tr>
        </thead>
        <tbody>
          {capture.network.targets.map((target) => (
            <tr key={target.target}>
              <td>
                {target.label}
                <span className="muted"> · {target.target}</span>
              </td>
              <td>{ms(target.medianMs, 0)}</td>
              <td>{ms(target.jitterMs)}</td>
              <td>{(target.lossShare * 100).toFixed(1)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Что именно нарисовано.
 *
 * Точек на экране может быть меньше, чем кадров в записи, и промолчать об этом
 * нельзя: человек читает график как полный. Здесь же и выход из увеличения.
 */
function ChartNote({
  series,
  zooming,
  windowed,
  onReset,
}: {
  series: Capture['series'];
  zooming: boolean;
  windowed: boolean;
  onReset: () => void;
}): React.JSX.Element | null {
  if (!series.decimated && !windowed) return null;

  return (
    <div className="chart-note">
      {series.decimated && (
        <span className="muted">
          Показано {series.time.length} точек из {series.sourceFrameCount} кадров: из
          каждого окна взяты самый короткий и самый длинный кадр, все статтеры оставлены.
          Приблизьте участок, чтобы увидеть его целиком.
        </span>
      )}
      {zooming && <span className="muted">Читаю участок…</span>}
      {windowed && (
        <button type="button" className="chip" onClick={onReset}>
          Показать запись целиком
        </button>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
