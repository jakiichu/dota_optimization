import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import process from 'node:process';
import { toAuditView } from '../adapters/http/audit.view.ts';
import { SensorViewMapper } from '../adapters/http/sensor.view.ts';
import { RunConfigurationAudit } from '../application/use-cases/run-configuration-audit.ts';
import { createCaptureRoute } from './capture-route.ts';
import { createBenchmarkRoutes } from './benchmark-routes.ts';
import { createConfigRoutes } from './config-routes.ts';
import { createMachineContextSource } from './game-config-source.ts';
import {
  createSessionAnalyzeRoute,
  createSessionCompareRoute,
  createSessionListRoute,
} from './session-routes.ts';
import { FileSessionStore } from '../infrastructure/sessions/file-session.store.ts';
import { allAuditRules } from '../domain/rules/rule-registry.ts';
import {
  startLocalServer,
  type JsonRoute,
  type StreamRoute,
} from '../infrastructure/http/local-server.ts';
import {
  ensureSidecarBuilt,
  SidecarSensorStream,
} from '../infrastructure/sensors/sidecar-sensor.stream.ts';
import { StartReplayRun } from '../application/use-cases/start-replay-run.ts';
import { SteamGameLauncher } from '../infrastructure/game/steam-game.launcher.ts';
import { RESOURCES } from '../infrastructure/paths/resources.ts';
import { WindowsSnapshotCollector } from '../infrastructure/windows/windows-snapshot.collector.ts';

/**
 * Composition root веб-интерфейса.
 *
 * Слои встречаются только здесь: сценарии не знают про HTTP, сервер не знает
 * про сценарии, а презентеры не знают ни про то, ни про другое.
 */

const DEFAULT_PORT = 7331;

/**
 * Сколько соседних портов пробуем, если основной занят.
 *
 * Занятый порт — обычное дело: остался прошлый запуск, или его отнял чужой
 * процесс. Падать с `EADDRINUSE` в лицо пользователю за это нельзя.
 */
const PORT_ATTEMPTS = 10;

/** Насколько ждём ответа от того, кто уже сидит на порту. */
const PROBE_TIMEOUT_MS = 1500;

const HEALTH_PATH = '/api/health';
const APP_ID = 'frameloss';

const UI_ROOT = RESOURCES.webRoot();

/** Записи лежат рядом с приложением: их носят вместе с ним и прикладывают к письмам. */
const sessionStore = new FileSessionStore(RESOURCES.sessionsRoot());

/**
 * Что известно о машине: конфиг игры и частота экрана.
 *
 * Один источник на всё приложение — и запись кадров, и разбор сохранённой
 * записи, и редактор конфига смотрят на одну и ту же машину. Редактор её же и
 * сбрасывает, поправив файл.
 */
const machineContext = createMachineContextSource();

/**
 * Эталонный прогон, один на приложение.
 *
 * Он помнит, какой повтор мы запустили, а запись кадров у него это спрашивает.
 * Два экземпляра означали бы, что запись помечается сценой от другого прогона.
 */
const replayRun = new StartReplayRun(new SteamGameLauncher());

/**
 * Отметка «это мы».
 *
 * Нужна, чтобы отличить свой прошлый запуск от чужой программы, занявшей порт:
 * в первом случае надо просто открыть браузер, во втором — уйти на другой порт.
 */
const healthRoute: JsonRoute = {
  path: HEALTH_PATH,
  handle: () => Promise.resolve({ app: APP_ID, pid: process.pid }),
};

const auditRoute: JsonRoute = {
  path: '/api/audit',
  async handle() {
    const { snapshot, report } = await new RunConfigurationAudit(
      new WindowsSnapshotCollector(),
      allAuditRules,
    ).execute();
    return toAuditView(snapshot, report);
  },
};

/**
 * Поток сенсоров.
 *
 * Процесс сайдкара один на всех подписчиков, а вот отсчёт времени — свой у
 * каждого: вкладка, открытая позже, должна видеть график с нуля, а не с
 * середины чужой сессии.
 */
const sensorStream = new SidecarSensorStream();

const sensorsRoute: StreamRoute = {
  path: '/api/sensors/stream',
  subscribe(send) {
    const mapper = new SensorViewMapper();
    return sensorStream.subscribe((sample) => send(mapper.toView(sample)));
  },
};

async function sidecarStatus(): Promise<string | null> {
  try {
    await ensureSidecarBuilt();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'EADDRINUSE'
  );
}

/**
 * Спрашивает у того, кто занял порт, не мы ли это.
 *
 * Ответ должен прийти быстро или не прийти вовсе: чужая программа может
 * держать соединение открытым сколько угодно, а нам нужно решение сейчас.
 */
async function isOurInstance(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      typeof body === 'object' &&
      body !== null &&
      'app' in body &&
      (body as { app: unknown }).app === APP_ID
    );
  } catch {
    // Не ответил, ответил мусором, оборвал соединение — значит, не мы.
    return false;
  }
}

interface Startup {
  readonly server: Awaited<ReturnType<typeof startLocalServer>> | null;
  /** Адрес уже запущенного экземпляра, если он нашёлся. */
  readonly existingUrl: string | null;
}

/**
 * Поднимает сервер, обходя занятые порты.
 *
 * Свой прошлый запуск и чужая программа на порту — разные ситуации: в первом
 * случае второй экземпляр не нужен вовсе, во втором надо просто отойти в
 * сторону. Отличаем их по ответу на /api/health.
 */
async function startServer(
  preferredPort: number,
  staticRoot: string | null,
): Promise<Startup> {
  const options = {
    jsonRoutes: [
      healthRoute,
      auditRoute,
      createCaptureRoute(sensorStream, sessionStore, machineContext, replayRun),
      ...createBenchmarkRoutes(replayRun),
      createSessionListRoute(sessionStore),
      createSessionCompareRoute(sessionStore),
      createSessionAnalyzeRoute(sessionStore, machineContext),
      ...createConfigRoutes(sessionStore, () => machineContext.forget()),
    ],
    streamRoutes: [sensorsRoute],
    staticRoot,
  };

  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    const port = preferredPort + attempt;
    try {
      return { server: await startLocalServer({ port, ...options }), existingUrl: null };
    } catch (error) {
      if (!isAddressInUse(error)) throw error;

      if (await isOurInstance(port)) {
        return { server: null, existingUrl: `http://127.0.0.1:${port}` };
      }
      process.stdout.write(`Порт ${port} занят кем-то другим, беру следующий.\n`);
    }
  }

  throw new Error(
    `Свободного порта не нашлось: пробовал ${preferredPort}–${preferredPort + PORT_ATTEMPTS - 1}. ` +
      'Задайте другой через переменную FRAMELOSS_PORT.',
  );
}

async function main(): Promise<void> {
  // Не останавливаемся: без сайдкара нет только показаний видеоадаптеров, а
  // аудит и запись кадров работают. Но сказать об этом надо сразу, иначе
  // пустой график выглядит как поломка.
  const sidecar = await sidecarStatus();
  if (sidecar !== null) {
    process.stdout.write(`${sidecar}\n`);
  }

  const port = Number.parseInt(process.env['FRAMELOSS_PORT'] ?? '', 10) || DEFAULT_PORT;
  const staticRoot = (await directoryExists(UI_ROOT)) ? UI_ROOT : null;

  const { server, existingUrl } = await startServer(port, staticRoot);

  if (server === null) {
    process.stdout.write(`frameloss уже запущен на ${existingUrl ?? ''} — открываю его.\n`);
    if (process.argv.includes('--open') && existingUrl !== null) {
      openInBrowser(existingUrl);
    }
    return;
  }

  process.stdout.write(`frameloss слушает ${server.url}\n`);
  if (staticRoot === null) {
    process.stdout.write('Интерфейс не собран: npm run ui:build (или npm run dev)\n');
  }

  if (process.argv.includes('--open')) {
    openInBrowser(server.url);
  }

  const running = server;
  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Открывает страницу в браузере по умолчанию.
 *
 * Через `cmd /c start`, а не напрямую: у Windows нет отдельной программы для
 * «открыть по умолчанию», это встроенная команда оболочки. Пустые кавычки —
 * обязательный аргумент-заголовок, без них URL уедет в заголовок окна.
 */
function openInBrowser(url: string): void {
  spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
