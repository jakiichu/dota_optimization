import { writeFile } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';
import { CaptureFrameSession } from '../application/use-cases/capture-frame-session.ts';
import { ReadSensors } from '../application/use-cases/read-sensors.ts';
import { RunConfigurationAudit } from '../application/use-cases/run-configuration-audit.ts';
import { renderCaptureReport } from '../adapters/presenters/console-capture.presenter.ts';
import { renderConsoleReport } from '../adapters/presenters/console-report.presenter.ts';
import { renderSensorSample } from '../adapters/presenters/console-sensors.presenter.ts';
import { actionableFindings } from '../domain/diagnostics/audit-report.ts';
import { allAuditRules } from '../domain/rules/rule-registry.ts';
import type { SnapshotCollector } from '../application/ports/snapshot-collector.port.ts';
import { JsonFileSnapshotCollector } from '../infrastructure/file/json-file-snapshot.collector.ts';
import { PresentMonCapture } from '../infrastructure/presentmon/presentmon.capture.ts';
import { SidecarSensorSampler } from '../infrastructure/sensors/sidecar-sensor.sampler.ts';
import { SidecarSensorStream } from '../infrastructure/sensors/sidecar-sensor.stream.ts';
import { WindowsSnapshotCollector } from '../infrastructure/windows/windows-snapshot.collector.ts';

/**
 * Composition root: единственное место, где слои знают друг о друге.
 */

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;

const DEFAULT_CAPTURE_SECONDS = 60;
const DEFAULT_PROCESS_NAME = 'dota2.exe';

interface Options {
  readonly verbose: boolean;
  readonly color: boolean;
  readonly json: boolean;
  readonly fromFile: string | null;
  readonly saveSnapshotTo: string | null;
  readonly processName: string;
  readonly seconds: number;
  readonly rawCsvPath: string | null;
}

const USAGE = `frameloss — диагностика потерь кадров на Windows

  node src/main/cli.ts audit [опции]     статический аудит конфигурации
  node src/main/cli.ts sensors [опции]   текущие показания видеоадаптеров
  node src/main/cli.ts capture [опции]   запись кадров и метрики по ней

Опции capture:
  --process <exe>         что записывать (по умолчанию dota2.exe)
  --seconds <N>           длительность записи (по умолчанию 60)
  --save-csv <путь>       сохранить сырой CSV от PresentMon

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
    seconds: Number.parseInt(valueAfter('--seconds') ?? '', 10) || DEFAULT_CAPTURE_SECONDS,
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
  ).execute({
    processName: options.processName,
    seconds: options.seconds,
    ...(options.rawCsvPath === null ? {} : { rawCsvPath: options.rawCsvPath }),
  });
  const { capture, statistics } = session;

  if (options.json) {
    stdout.write(`${JSON.stringify(session, null, 2)}\n`);
  } else {
    stdout.write(
      `${renderCaptureReport(capture, statistics, session.correlation, {
        color: options.color,
      })}\n`,
    );
  }

  return statistics.frameCount === 0 ? EXIT_ERROR : EXIT_OK;
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
