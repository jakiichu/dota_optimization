import { toCaptureView } from '../adapters/http/capture.view.ts';
import { CaptureFrameSession } from '../application/use-cases/capture-frame-session.ts';
import type { JsonRoute } from '../infrastructure/http/local-server.ts';
import { PresentMonCapture } from '../infrastructure/presentmon/presentmon.capture.ts';

const DEFAULT_PROCESS_NAME = 'dota2.exe';
const DEFAULT_SECONDS = 60;
const MIN_SECONDS = 5;
const MAX_SECONDS = 600;

/**
 * Запись кадров по запросу интерфейса.
 *
 * Одновременно идёт только одна: PresentMon держит именованную ETW-сессию, и
 * вторая запись оборвала бы первую на середине.
 */
export function createCaptureRoute(): JsonRoute {
  const session = new CaptureFrameSession(new PresentMonCapture());
  let inFlight: Promise<unknown> | null = null;

  return {
    path: '/api/capture',
    async handle(query) {
      if (inFlight !== null) {
        throw new Error('Запись уже идёт — дождитесь её окончания.');
      }

      const request = {
        processName: query.get('process') ?? DEFAULT_PROCESS_NAME,
        seconds: clampSeconds(query.get('seconds')),
      };

      const running = session
        .execute(request)
        .then(({ capture, statistics }) => toCaptureView(capture, statistics));
      inFlight = running;

      try {
        return await running;
      } finally {
        inFlight = null;
      }
    },
  };
}

function clampSeconds(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SECONDS;
  return Math.min(Math.max(parsed, MIN_SECONDS), MAX_SECONDS);
}
