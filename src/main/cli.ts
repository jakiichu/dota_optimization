import { writeFile } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';
import { AnalyzeSession } from '../application/use-cases/analyze-session.ts';
import { CaptureFrameSession } from '../application/use-cases/capture-frame-session.ts';
import { CompareSessions } from '../application/use-cases/compare-sessions.ts';
import { ReadSensors } from '../application/use-cases/read-sensors.ts';
import { RunConfigurationAudit } from '../application/use-cases/run-configuration-audit.ts';
import { renderCaptureReport } from '../adapters/presenters/console-capture.presenter.ts';
import { renderComparison } from '../adapters/presenters/console-comparison.presenter.ts';
import { renderConsoleReport } from '../adapters/presenters/console-report.presenter.ts';
import { renderSensorSample } from '../adapters/presenters/console-sensors.presenter.ts';
import { actionableFindings } from '../domain/diagnostics/audit-report.ts';
import { allAuditRules } from '../domain/rules/rule-registry.ts';
import { createMachineContextSource } from './game-config-source.ts';
import {
  isUsableReplay,
  planReplayBenchmark,
} from '../domain/gameconfig/benchmark-plan.ts';
import { UNKNOWN_SCENE, type CaptureScene, type SceneKind } from '../domain/telemetry/capture-scene.ts';
import type { SnapshotCollector } from '../application/ports/snapshot-collector.port.ts';
import { JsonFileSnapshotCollector } from '../infrastructure/file/json-file-snapshot.collector.ts';
import { PresentMonCapture } from '../infrastructure/presentmon/presentmon.capture.ts';
import { SidecarSensorSampler } from '../infrastructure/sensors/sidecar-sensor.sampler.ts';
import { SidecarSensorStream } from '../infrastructure/sensors/sidecar-sensor.stream.ts';
import { FileSessionStore } from '../infrastructure/sessions/file-session.store.ts';
import { RESOURCES } from '../infrastructure/paths/resources.ts';
import { WindowsSnapshotCollector } from '../infrastructure/windows/windows-snapshot.collector.ts';

/**
 * Composition root: единственное место, где слои знают друг о друге.
 */

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;

const DEFAULT_CAPTURE_SECONDS = 60;
const DEFAULT_PROCESS_NAME = 'dota2.exe';
const NEWLINE = String.fromCharCode(10);
/** Тик по умолчанию: середина матча, где нагрузка уже настоящая. */
const DEFAULT_BENCH_TICK = 40000;

interface Options {
  readonly verbose: boolean;
  readonly color: boolean;
  readonly json: boolean;
  readonly fromFile: string | null;
  readonly saveSnapshotTo: string | null;
  readonly processName: string;
  readonly seconds: number;
  readonly rawCsvPath: string | null;
  readonly label: string | null;
  readonly scene: CaptureScene;
}

const USAGE = `frameloss — диагностика потерь кадров на Windows

  node src/main/cli.ts audit [опции]     статический аудит конфигурации
  node src/main/cli.ts sensors [опции]   текущие показания видеоадаптеров
  node src/main/cli.ts capture [опции]   запись кадров и метрики по ней
  node src/main/cli.ts sessions          список сохранённых записей
  node src/main/cli.ts analyze <id>      пересчитать запись текущими метриками
  node src/main/cli.ts compare <до> <после>  сравнить две записи
  node src/main/cli.ts bench [опции]     план повторяемого замера по повтору

Опции capture:
  --process <exe>         что записывать (по умолчанию dota2.exe)
  --seconds <N>           длительность записи (по умолчанию 60)
  --save-csv <путь>       сохранить сырой CSV от PresentMon
  --label <текст>         подпись записи, например «до отключения MPO»
  --scene <вид>           replay | hero-demo | match | menu — что записывали
  --replay <файл>         имя повтора, если сцена replay
  --tick <N>              тик, с которого начинали повтор

Опции audit:
  --verbose               показать и успешные проверки
  --from-file <путь>      разобрать сохранённый снимок вместо живой машины
  --save-snapshot <путь>  сохранить собранный снимок

Общие опции:
  --json                  выдать машинный JSON вместо текста
  --no-color              без ANSI-раскраски

Код возврата: 0 — чисто, 1 — есть находки уровня «внимание» или выше, 2 — ошибка.`;

function parseOptions(args: readonly string[]): Options {
  const valueAfter = (flag: string): string | null => {
    const index = args.indexOf(flag);
    if (index === -1) return null;
    return args[index + 1] ?? null;
  };

  return {
    verbose: args.includes('--verbose'),
    color: !args.includes('--no-color'),
    json: args.includes('--json'),
    fromFile: valueAfter('--from-file'),
    saveSnapshotTo: valueAfter('--save-snapshot'),
    processName: valueAfter('--process') ?? DEFAULT_PROCESS_NAME,
    rawCsvPath: valueAfter('--save-csv'),
    label: valueAfter('--label'),
    scene: sceneFrom(valueAfter),
    seconds: Number.parseInt(valueAfter('--seconds') ?? '', 10) || DEFAULT_CAPTURE_SECONDS,
  };
}

const SCENE_KINDS: readonly SceneKind[] = ['replay', 'hero-demo', 'match', 'menu', 'unknown'];

/** Не указали сцену — так и пишем: выдуманная хуже отсутствующей. */
function sceneFrom(valueAfter: (flag: string) => string | null): CaptureScene {
  const kind = SCENE_KINDS.find((candidate) => candidate === valueAfter('--scene'));
  if (kind === undefined) return UNKNOWN_SCENE;

  const tick = Number.parseInt(valueAfter('--tick') ?? '', 10);
  return {
    kind,
    replayFile: valueAfter('--replay'),
    startTick: Number.isFinite(tick) ? tick : null,
    note: valueAfter('--note'),
  };
}

async function runAudit(options: Options): Promise<number> {
  const collector: SnapshotCollector =
    options.fromFile === null
      ? new WindowsSnapshotCollector()
      : new JsonFileSnapshotCollector(options.fromFile);

  const { snapshot, report } = await new RunConfigurationAudit(
    collector,
    allAuditRules,
  ).execute();

  if (options.saveSnapshotTo !== null) {
    await writeFile(options.saveSnapshotTo, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(
      `${renderConsoleReport(snapshot, report, {
        verbose: options.verbose,
        color: options.color,
      })}\n`,
    );
  }

  return actionableFindings(report).length > 0 ? EXIT_FINDINGS : EXIT_OK;
}

async function runSensors(options: Options): Promise<number> {
  const sample = await new ReadSensors(new SidecarSensorSampler()).execute();

  if (options.json) {
    stdout.write(`${JSON.stringify(sample, null, 2)}\n`);
  } else {
    stdout.write(`${renderSensorSample(sample, { color: options.color })}\n`);
  }

  return EXIT_OK;
}

async function runCapture(options: Options): Promise<number> {
  stderr.write(
    `Записываю ${options.processName} ${options.seconds} с. ` +
      'PresentMon требует прав администратора — подтвердите запрос UAC.\n',
  );

  const session = await new CaptureFrameSession(
    new PresentMonCapture(),
    new SidecarSensorStream(),
    () => machineContext.get(),
  ).execute({
    processName: options.processName,
    seconds: options.seconds,
    ...(options.rawCsvPath === null ? {} : { rawCsvPath: options.rawCsvPath }),
  });
  const summary = await sessionStore.save(
    options.label ?? '',
    options.scene,
    session.capture,
    session.sensorSamples,
  );
  stderr.write(`Запись сохранена: ${summary.id}\n`);
  const { capture, statistics } = session;

  if (options.json) {
    stdout.write(`${JSON.stringify(session, null, 2)}\n`);
  } else {
    stdout.write(
      `${renderCaptureReport(capture, statistics, session.correlation, session.network, session.cpuLoad, session.recommendations, {
        color: options.color,
      })}\n`,
    );
  }

  return statistics.frameCount === 0 ? EXIT_ERROR : EXIT_OK;
}

const sessionStore = new FileSessionStore(RESOURCES.sessionsRoot());
const machineContext = createMachineContextSource();

async function runSessions(options: Options): Promise<number> {
  const sessions = await sessionStore.list();

  if (options.json) {
    stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return EXIT_OK;
  }

  if (sessions.length === 0) {
    stdout.write('Записей нет. Сделайте первую: npm run capture\n');
    return EXIT_OK;
  }

  for (const session of sessions) {
    stdout.write(
      `${session.id}\n` +
        `  ${session.label} · ${session.durationSeconds.toFixed(0)} с · ` +
        `p99 ${session.frameTime.p99.toFixed(1)} мс · ` +
        `статтеров ${session.stutterCount}\n`,
    );
  }
  return EXIT_OK;
}

/**
 * Пересчёт сохранённой записи.
 *
 * Метрики — чистые функции от кадров, поэтому новый детектор применяется к
 * старым записям без запуска игры.
 */
async function runAnalyze(id: string | undefined, options: Options): Promise<number> {
  if (id === undefined) {
    stderr.write('Нужен идентификатор записи. Список: npm run sessions\n');
    return EXIT_ERROR;
  }

  const analyzed = await new AnalyzeSession(sessionStore, () => machineContext.get()).execute(id);

  if (options.json) {
    stdout.write(`${JSON.stringify(analyzed, null, 2)}\n`);
  } else {
    stdout.write(
      `${renderCaptureReport(analyzed.capture, analyzed.statistics, analyzed.correlation, analyzed.network, analyzed.cpuLoad, analyzed.recommendations, {
        color: options.color,
      })}
`,
    );
  }
  return EXIT_OK;
}

async function runCompare(
  beforeId: string | undefined,
  afterId: string | undefined,
  options: Options,
): Promise<number> {
  if (beforeId === undefined || afterId === undefined) {
    stderr.write('Нужны две записи. Список: npm run sessions' + NEWLINE);
    return EXIT_ERROR;
  }

  const comparison = await new CompareSessions(sessionStore).execute(beforeId, afterId);

  if (options.json) {
    stdout.write(JSON.stringify(comparison, null, 2) + NEWLINE);
  } else {
    stdout.write(renderComparison(comparison, { color: options.color }) + NEWLINE);
  }
  return EXIT_OK;
}

/**
 * План замера, который можно повторить.
 *
 * Записи из разных сцен несравнимы, а повтор проигрывает одни и те же кадры —
 * это единственный способ померить одно и то же дважды.
 */
async function runBench(options: Options): Promise<number> {
  const { snapshot } = await new RunConfigurationAudit(
    new WindowsSnapshotCollector(),
    allAuditRules,
  ).execute();

  const replays = snapshot.games
    .flatMap((game) => game.replays)
    .filter(isUsableReplay);

  if (replays.length === 0) {
    stdout.write(
      'Повторов не нашлось. Скачайте любой матч в игре: вкладка «Повторы» → ' +
        'скачать. Без повтора замер нельзя воспроизвести точно.' + NEWLINE,
    );
    return EXIT_OK;
  }

  const chosen = options.scene.replayFile ?? replays[0]?.name ?? '';
  const tick = options.scene.startTick ?? DEFAULT_BENCH_TICK;

  stdout.write('Доступные повторы:' + NEWLINE);
  for (const replay of replays) {
    const size = (replay.sizeBytes / (1024 * 1024)).toFixed(0);
    stdout.write(`  ${replay.name} · ${size} МБ` + NEWLINE);
  }
  stdout.write(NEWLINE);

  const plan = planReplayBenchmark(chosen, tick, options.seconds, options.label ?? 'замер');

  stdout.write(`План замера: ${chosen}, тик ${tick}` + NEWLINE);
  plan.steps.forEach((step, index) => {
    stdout.write(`  ${index + 1}. ${step}` + NEWLINE);
  });
  stdout.write(NEWLINE + 'Команда записи:' + NEWLINE);
  stdout.write(`  ${plan.captureCommand}` + NEWLINE);
  return EXIT_OK;
}

async function main(): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  if (command === undefined || command === '--help' || command === '-h') {
    stdout.write(`${USAGE}\n`);
    return EXIT_OK;
  }

  const options = parseOptions(args);

  if (command === 'audit') return runAudit(options);
  if (command === 'sensors') return runSensors(options);
  if (command === 'capture') return runCapture(options);
  if (command === 'sessions') return runSessions(options);
  if (command === 'analyze') return runAnalyze(args[1], options);
  if (command === 'compare') return runCompare(args[1], args[2], options);
  if (command === 'bench') return runBench(options);

  stderr.write(`Неизвестная команда: ${command}\n\n${USAGE}\n`);
  return EXIT_ERROR;
}

main().then(
  (code) => exit(code),
  (error: unknown) => {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof Error && error.cause !== undefined) {
      stderr.write(`${String(error.cause)}\n`);
    }
    exit(EXIT_ERROR);
  },
);
