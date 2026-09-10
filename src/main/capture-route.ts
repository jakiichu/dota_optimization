import { toCaptureView } from '../adapters/http/capture.view.ts';
import { CaptureFrameSession } from '../application/use-cases/capture-frame-session.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';
import { PresentMonCapture } from '../infrastructure/presentmon/presentmon.capture.ts';
import type { MachineContextSource } from './game-config-source.ts';
import type { StartReplayRun } from '../application/use-cases/start-replay-run.ts';
import type { SensorStream } from '../application/ports/sensor-stream.port.ts';
import type { SessionStore } from '../application/ports/session-store.port.ts';
import { UNKNOWN_SCENE, type CaptureScene, type SceneKind } from '../domain/telemetry/capture-scene.ts';

const DEFAULT_PROCESS_NAME = 'dota2.exe';
const DEFAULT_SECONDS = 60;
const MIN_SECONDS = 5;

/**
 * Верхняя граница записи — четыре часа.
 *
 * Раньше стояло десять минут, и этого хватало ровно на то, ради чего запись
 * задумывалась: короткий кусок для сравнения настроек. Но на тридцати секундах
 * половина метрик — фикция: p99.9 при 60 кадрах — это второй худший кадр из
 * 1800, то есть одна случайная загрузка текстуры. На целом матче то же число
 * считается по сотне тысяч кадров и наконец значит то, что обещает.
 *
 * Граница всё равно есть, и убрать её нельзя: процесс, поднятый через UAC, нам
 * не принадлежит, и остановиться он обязан сам.
 */
const MAX_SECONDS = 4 * 60 * 60;

/**
 * Запись кадров по запросу интерфейса.
 *
 * Одновременно идёт только одна: PresentMon держит именованную ETW-сессию, и
 * вторая запись оборвала бы первую на середине.
 */
export function createCaptureRoutes(
  sensors: SensorStream,
  store: SessionStore,
  machine: MachineContextSource,
  replayRun: StartReplayRun,
): readonly JsonRoute[] {
  const frames = new PresentMonCapture();
  const session = new CaptureFrameSession(frames, sensors, () => machine.get());
  let inFlight: Promise<unknown> | null = null;

  const capture: JsonRoute = {
    path: '/api/capture',
    async handle(query) {
      if (inFlight !== null) {
        throw new Error('Запись уже идёт — дождитесь её окончания.');
      }

      // «Вся игра»: длину матча заранее не знает никто, поэтому длительность
      // становится верхней границей, а остановит запись выход из игры.
      const wholeGame = query.get('whole') === '1';
      const request = {
        processName: query.get('process') ?? DEFAULT_PROCESS_NAME,
        seconds: wholeGame ? MAX_SECONDS : clampSeconds(query.get('seconds')),
        stopWhenGameExits: wholeGame,
      };

      // Сохраняем всё, что записали: сравнение «до и после» разделено
      // перезагрузкой, и запись, оставшаяся только в памяти, для него бесполезна.
      const running = session.execute(request).then(async (result) => {
        const summary = await store.save(
          query.get('label') ?? '',
          await sceneOf(replayRun, query),
          await machine.passport(),
          result.capture,
          result.sensorSamples,
        );
        return { ...toCaptureView(result), sessionId: summary.id };
      });
      inFlight = running;

      try {
        return await running;
      } finally {
        inFlight = null;
      }
    },
  };

  /**
   * Досрочная остановка.
   *
   * Нужна ровно из-за записи целого матча: заказав четыре часа, человек должен
   * иметь возможность передумать. Запрос UAC появится второй раз — своего
   * процесса у нас нет, и остановить сессию может только новый экземпляр
   * PresentMon с теми же правами.
   */
  const stop: JsonRoute = {
    path: '/api/capture/stop',
    method: 'POST',
    async handle() {
      if (inFlight === null) {
        throw new Error('Останавливать нечего: запись не идёт.');
      }
      await frames.stop();
      return { stopping: true };
    },
  };

  return [capture, stop];
}

/**
 * Чем помечена запись.
 *
 * Если игру запустили мы — сцену знаем точно: файл повтора и тик мы сами
 * положили в её команды запуска. Это и есть весь смысл эталонного прогона:
 * сцена перестаёт быть тем, что человек про неё написал.
 *
 * Прогона нет — возвращаемся к тому, что сказали в запросе.
 */
async function sceneOf(
  replayRun: StartReplayRun,
  query: URLSearchParams,
): Promise<CaptureScene> {
  const running = await replayRun.currentRun();
  if (running === null) return sceneFromQuery(query);

  return {
    kind: 'replay',
    replayFile: running.replayFile,
    startTick: running.startTick,
    note: running.label === '' ? null : running.label,
  };
}

const SCENE_KINDS: readonly SceneKind[] = ['replay', 'hero-demo', 'match', 'menu', 'unknown'];

/**
 * Сцена из параметров запроса.
 *
 * Не указали — так и пишем: выдуманная сцена хуже отсутствующей, потому что
 * по ней потом сделают вывод.
 */
function sceneFromQuery(query: URLSearchParams): CaptureScene {
  const kind = SCENE_KINDS.find((candidate) => candidate === query.get('scene'));
  if (kind === undefined) return UNKNOWN_SCENE;

  const tick = Number.parseInt(query.get('tick') ?? '', 10);
  return {
    kind,
    replayFile: query.get('replay'),
    startTick: Number.isFinite(tick) ? tick : null,
    note: query.get('note'),
  };
}

function clampSeconds(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SECONDS;
  return Math.min(Math.max(parsed, MIN_SECONDS), MAX_SECONDS);
}
