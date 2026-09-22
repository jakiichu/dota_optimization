import type { CaptureController } from '../../application/use-capture-controller.ts';
import { useEffect, useState } from 'react';
import {
  useBenchmark,
  useSessionAnalysis,
  useSessions,
  useSessionWindow,
} from '../../application/queries.ts';
import type { Capture, ConfigChange, CpuLoad, FrameWindow } from '../../domain/models.ts';
import { BOTTLENECK_COLOR, BOTTLENECK_LABEL } from '../../domain/presentation.ts';
import { dateTime, ms, seconds } from '../../domain/formatting.ts';
import { CorrelationPanel } from '../components/CorrelationPanel.tsx';
import { FrameTimeChart } from '../components/FrameTimeChart.tsx';
import { PacingPanel } from '../components/PacingPanel.tsx';
import { RecommendationPanel } from '../components/RecommendationPanel.tsx';
import { ReportExportPanel } from '../components/ReportExportPanel.tsx';
import { StutterInspector } from '../components/StutterInspector.tsx';
import { inspectableStutters, type StutterInspection } from '../../domain/stutter-inspection.ts';
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

export function CaptureSection({
  recorder,
  onOpenInConfig,
}: {
  recorder: CaptureController;
  /** Уйти в редактор конфига с подставленным изменением из рекомендации. */
  onOpenInConfig: (changes: readonly ConfigChange[]) => void;
}): React.JSX.Element {
  const [processName, setProcessName] = useState(DEFAULT_PROCESS);
  const [durationSeconds, setDurationSeconds] = useState<number>(60);
  // Подпись нужна, чтобы через полчаса отличить «до HAGS» от «после».
  const [label, setLabel] = useState('');

  const { capture, recording, startsIn } = recorder;
  const benchmark = useBenchmark();
  const runActive = benchmark.data?.state.current != null;
  // Сохранённая запись, которую открыли посмотреть. Новая запись эту замену
  // отменяет: смотреть старую, когда только что сделали свежую, незачем.
  const [openedId, setOpenedId] = useState<string | null>(recorder.status.data?.sessionId ?? null);
  useEffect(() => {
    if (recorder.status.data?.sessionId) setOpenedId(recorder.status.data.sessionId);
  }, [recorder.status.data?.sessionId]);
  const opened = useSessionAnalysis(openedId);
  const shownCapture = capture.data !== undefined &&
    (openedId === null || openedId === capture.data.sessionId) ? capture.data : opened.data;
  const wholeGame = durationSeconds === WHOLE_GAME;
  const begin = (): void => recorder.begin({
    processName, seconds: wholeGame ? 0 : durationSeconds, label, wholeGame,
  });

  return (
    <>
      <SectionHeader
        title="Запись и разбор"
        subtitle="Запишите игру, чтобы увидеть просадки плавности и возможные причины."
      />

      <div className="card capture-setup">
        <div className="card-head"><span className="card-title">Новая запись</span><span className="card-note">Старт через 5 секунд после нажатия</span></div>
        <p className="setup-description">Запустите Dota 2, выберите длительность и нажмите «Начать запись». Затем вернитесь в игру.</p>
        <div className="capture-form">
        <label>
          <span className="metric-label">Длительность</span>
          <select
            className="input"
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(Number(event.target.value))}
            disabled={recorder.blocked}
          >
            {DURATIONS.map((value) => (
              <option key={value} value={value}>
                {value < 60 ? `${value} секунд` : `${value / 60} мин`}
              </option>
            ))}
            <option value={WHOLE_GAME}>До выхода из игры</option>
          </select>
        </label>
        <label>
          <span className="metric-label">Название <span className="optional-label">необязательно</span></span>
          <input
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Например, до изменения настроек"
            disabled={recorder.blocked}
          />
        </label>
        <button
          type="button"
          className="button primary"
          disabled={recorder.blocked}
          onClick={begin}
        >
          {startsIn !== null
            ? `Вернитесь в игру… ${startsIn}`
            : recording
              ? 'Запись идёт…'
              : runActive
                ? 'Записать прогон'
                : 'Начать запись'}
        </button>

        <details className="advanced-options">
          <summary>Дополнительно: процесс для записи</summary>
          <label><span className="metric-label">Имя процесса</span>
            <input className="input" value={processName} onChange={(event) => setProcessName(event.target.value)} disabled={recorder.blocked} />
          </label>
          <p className="muted">Для Dota 2 оставьте dota2.exe.</p>
        </details>
        </div>
      </div>

      <details className="replay-disclosure" open={runActive || undefined}>
        <summary><span><strong>Повтор для точного сравнения</strong><span className="muted">Одинаковая сцена до и после изменения настройки</span></span></summary>
        <ReplayRunPanel recorder={{ recording, startsIn, onRecord: begin }} />
      </details>

      {/* Молча ждать пять секунд нельзя: человек решит, что кнопка не нажалась,
          и нажмёт ещё раз. */}
      {startsIn !== null && (
        <EmptyState>
          Запись начнётся через {startsIn} с. Переключитесь в игру и не сворачивайте её во время замера — это влияет на результат.
        </EmptyState>
      )}

      {recording && (
        <EmptyState>
          Если Windows запросит права администратора, подтвердите запуск записи.
          {recorder.status.data?.wholeGame && ' Запись закончится при выходе из игры.'}
          {' Остановить раньше можно в панели сверху. Windows может повторно запросить права.'}
        </EmptyState>
      )}

      {capture.isError && <ErrorState message={capture.error.message} />}

      <SavedCaptures
        openedId={openedId}
        onOpen={(id) => {
          if (!recording) capture.reset();
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
  if (sessions.isError) return <ErrorState message={sessions.error.message} onRetry={() => void sessions.refetch()} />;
  if (sessions.data === undefined) return null;
  if (sessions.data.length === 0) return <div className="card"><div className="card-title">Здесь будут ваши записи</div><p className="muted">После первого замера появятся график плавности, разбор рывков и рекомендации. Запись сохранится автоматически.</p></div>;

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
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  const zoomed = useSessionWindow(capture.sessionId, window);
  const shown = zoomed.data?.series ?? capture.series;
  const stutters = inspectableStutters(capture);
  const selected = stutters.find((entry) => entry.stutter.frameIndex === selectedFrameIndex)
    ?? stutters[0]
    ?? null;
  const inspect = (entry: StutterInspection): void => {
    setSelectedFrameIndex(entry.stutter.frameIndex);
    const padding = 1.5;
    setWindow({
      fromSeconds: Math.max(0, entry.stutter.atSeconds - padding),
      toSeconds: Math.min(capture.durationSeconds, entry.stutter.atSeconds + padding),
    });
  };

  if (capture.frameCount === 0) {
    return (
      <EmptyState>
        Кадров не записано: процесс {capture.application} не рисовал в это время.
      </EmptyState>
    );
  }

  return (
    <>
      <ReportExportPanel capture={capture} />
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
          selectedAtSeconds={selected?.stutter.atSeconds ?? null}
          onStutterSelect={(mark) => {
            const entry = stutters.find((item) => item.stutter.frameIndex === mark.frameIndex);
            if (entry !== undefined) inspect(entry);
          }}
        />
        <ChartNote
          series={shown}
          zooming={zoomed.isFetching}
          windowed={window !== null}
          onReset={() => setWindow(null)}
        />
      </div>

      <StutterInspector stutters={stutters} selectedFrameIndex={selectedFrameIndex} onSelect={inspect} />

      <div className="card">
        <div className="metrics">
          <Metric label="Средний FPS" note="Кадров в секунду · больше — лучше" value={capture.averageFps.toFixed(1)} />
          <Metric label="Обычный кадр" note="Медиана · меньше — лучше" value={ms(capture.frameTime.p50)} />
          <Metric label="95% кадров · p95" value={ms(capture.frameTime.p95)} />
          <Metric label="Долгие кадры · p99" note="99% кадров укладываются в это время" value={ms(capture.frameTime.p99)} />
          <Metric label="Редкие задержки · p99.9" value={ms(capture.frameTime.p999)} note="99,9% кадров укладываются в это время" />
          {capture.inputLatency !== null && (
            <Metric
              label="инпут-лаг p99"
              value={ms(capture.inputLatency.p99)}
              note={`по ${capture.inputLatencyFrames} кадрам с вводом`}
            />
          )}
          <Metric
            label="Рывки (статтеры)"
            note="Резкие скачки времени кадра"
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

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  /** На чём число стоит: без этого «p99» звучит одинаково по дюжине и по тысяче. */
  note?: string;
}): React.JSX.Element {
  return (
    <div>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {note !== undefined && <span className="metric-note">{note}</span>}
    </div>
  );
}
