import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Как называется эта сборка.
 *
 * Нужно ровно затем, чтобы сборки можно было раздавать людям. Получив отчёт
 * «у меня цифры другие», первым делом спрашивают «а версия какая» — и без
 * ответа на это разговор дальше не идёт.
 *
 * Складывается из трёх частей, и каждая отвечает на свой вопрос:
 * версия из `package.json` — что обещано, коммит — что собрано на самом деле,
 * пометка «правки» — что собрано не из коммита, а из чьей-то рабочей копии.
 * Последнее важнее первых двух: сборка с незакоммиченными правками
 * невоспроизводима, и молчать об этом нельзя.
 *
 * Дата не входит намеренно. Она меняется при каждой пересборке того же кода,
 * и две одинаковые сборки выглядели бы разными.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildVersion() {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const commit = git(['rev-parse', '--short', 'HEAD']);
  if (commit === null) return version;

  return `${version}+${commit}${isDirty() ? '-правки' : ''}`;
}

function isDirty() {
  const status = git(['status', '--porcelain']);
  return status !== null && status !== '';
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
