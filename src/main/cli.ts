import { writeFile } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';
import { RunConfigurationAudit } from '../application/use-cases/run-configuration-audit.ts';
import { renderConsoleReport } from '../adapters/presenters/console-report.presenter.ts';
import { actionableFindings } from '../domain/diagnostics/audit-report.ts';
import { allAuditRules } from '../domain/rules/rule-registry.ts';
import type { SnapshotCollector } from '../application/ports/snapshot-collector.port.ts';
import { JsonFileSnapshotCollector } from '../infrastructure/file/json-file-snapshot.collector.ts';
import { WindowsSnapshotCollector } from '../infrastructure/windows/windows-snapshot.collector.ts';

/**
 * Composition root: единственное место, где слои знают друг о друге.
 */

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;

interface Options {
  readonly verbose: boolean;
  readonly color: boolean;
  readonly json: boolean;
  readonly fromFile: string | null;
  readonly saveSnapshotTo: string | null;
}

const USAGE = `frameloss audit — статический аудит игровой конфигурации Windows

  node src/main/cli.ts audit [опции]

  --verbose             показать и успешные проверки
  --json                выдать отчёт машинным JSON вместо текста
  --no-color            без ANSI-раскраски
  --from-file <путь>    разобрать сохранённый снимок вместо живой машины
  --save-snapshot <путь> сохранить собранный снимок (для отправки или сравнения)

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
  };
}

async function main(): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  if (command === undefined || command === '--help' || command === '-h') {
    stdout.write(`${USAGE}\n`);
    return EXIT_OK;
  }
  if (command !== 'audit') {
    stderr.write(`Неизвестная команда: ${command}\n\n${USAGE}\n`);
    return EXIT_ERROR;
  }

  const options = parseOptions(args);
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
