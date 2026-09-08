import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import process from 'node:process';
import { toAuditView } from '../adapters/http/audit.view.ts';
import { SensorViewMapper } from '../adapters/http/sensor.view.ts';
import { RunConfigurationAudit } from '../application/use-cases/run-configuration-audit.ts';
import { createCaptureRoute } from './capture-route.ts';
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
import { RESOURCES } from '../infrastructure/paths/resources.ts';
import { WindowsSnapshotCollector } from '../infrastructure/windows/windows-snapshot.collector.ts';

/**
 * Composition root веб-интерфейса.
 *
 * Слои встречаются только здесь: сценарии не знают про HTTP, сервер не знает
 * про сценарии, а презентеры не знают ни про то, ни про другое.
 */

const DEFAULT_PORT = 7331;
const UI_ROOT = RESOURCES.webRoot();

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

async function main(): Promise<void> {
  // Не останавливаемся: без сайдкара нет только показаний видеоадаптеров, а
  // аудит и запись кадров работают. Но сказать об этом надо сразу, иначе
  // пустой график выглядит как поломка.
  const sidecar = await sidecarStatus();
  if (sidecar !== null) {
    process.stdout.write(`${sidecar}
`);
  }

  const port = Number.parseInt(process.env['FRAMELOSS_PORT'] ?? '', 10) || DEFAULT_PORT;
  const staticRoot = (await directoryExists(UI_ROOT)) ? UI_ROOT : null;

  const server = await startLocalServer({
    port,
    jsonRoutes: [auditRoute, createCaptureRoute(sensorStream)],
    streamRoutes: [sensorsRoute],
    staticRoot,
  });

  process.stdout.write(`frameloss слушает ${server.url}\n`);
  if (staticRoot === null) {
    process.stdout.write('Интерфейс не собран: npm run ui:build (или npm run dev)\n');
  }

  if (process.argv.includes('--open')) {
    openInBrowser(server.url);
  }

  const shutdown = (): void => {
    void server.close().then(() => process.exit(0));
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
