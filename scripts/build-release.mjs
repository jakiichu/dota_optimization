import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ensurePresentMon } from './fetch-presentmon.mjs';
import { buildVersion } from './version.mjs';

/**
 * Собирает приложение в папку, которую можно скопировать на любую машину с
 * Windows и запустить двойным щелчком.
 *
 * На целевой машине не нужны ни Node, ни .NET, ни npm install: рантайм Node
 * запечён в exe (Single Executable Application), сайдкар публикуется
 * самодостаточным. Именно это и было целью — «перешёл на другое устройство»
 * не должно означать «поставь четыре инструмента».
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'build');
const OUT = join(ROOT, 'release');
const EXE_NAME = 'kadroskop.exe';
const VERSION = buildVersion();

/**
 * `shell: true` нужен только для npm и dotnet — это .cmd-обёртки, напрямую они
 * не запускаются. Для обычных exe оболочка вредна: путь с пробелом (а Node
 * живёт в «Program Files») она разорвёт на две части.
 *
 * Через оболочку команда собирается одной строкой с ручными кавычками: Node
 * ругается на массив аргументов вместе с `shell: true`, потому что сам их не
 * экранирует, — и ругается справедливо.
 */
function run(command, args, options = {}) {
  const useShell = options.shell ?? true;
  const result = useShell
    ? spawnSync([command, ...args.map(quote)].join(' '), {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
      })
    : spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });

  if (result.status !== 0) {
    throw new Error(`Команда не выполнилась: ${command} ${args.join(' ')}`);
  }
}

/** Кавычки нужны там, где в пути есть пробел; лишние кавычки безвредны. */
function quote(argument) {
  return /[\s"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument;
}

function step(message) {
  process.stdout.write(`\n=== ${message}\n`);
}

// --- 1. Интерфейс -----------------------------------------------------------

step('Собираю интерфейс');
run('npm', ['run', 'ui:build']);

// --- 2. Сайдкар, самодостаточный --------------------------------------------

step('Собираю сайдкар без зависимости от рантайма .NET');
const sidecarOut = join(BUILD, 'sidecar');
run('dotnet', [
  'publish',
  'sidecar/Kadroskop.Sidecar/Kadroskop.Sidecar.csproj',
  '-c',
  'Release',
  '-r',
  'win-x64',
  '--self-contained',
  'true',
  '-p:PublishSingleFile=true',
  // Обрезка отключена намеренно: сайдкар зовёт NVML через P/Invoke, и триммер
  // не видит этих вызовов — вырежет как раз то, ради чего он написан.
  '-p:PublishTrimmed=false',
  '-o',
  sidecarOut,
  '--nologo',
]);

// --- 3. Сервер в один файл --------------------------------------------------

step('Свожу серверный код в один файл');
mkdirSync(BUILD, { recursive: true });
const bundlePath = join(BUILD, 'kadroskop.cjs');

await build({
  entryPoints: [join(ROOT, 'src', 'main', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  // SEA умеет запускать только CommonJS, поэтому формат не ESM.
  format: 'cjs',
  outfile: bundlePath,
  minify: false,
  legalComments: 'none',
  // Приложение узнаёт, что оно собрано, отсюда: ресурсы лежат рядом с exe, а
  // не в дереве исходников.
  define: {
    KADROSKOP_PACKAGED: 'true',
    KADROSKOP_VERSION: JSON.stringify(VERSION),
  },
  // `import.meta` в CommonJS не существует — мы это знаем и обрабатываем.
  // Предупреждение об этом каждый раз выглядит как поломка сборки.
  logOverride: { 'empty-import-meta': 'silent' },
});

// --- 4. Запекаем в exe ------------------------------------------------------

step('Запекаю рантайм Node в exe');
const seaConfig = join(BUILD, 'sea-config.json');
writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: bundlePath,
      output: join(BUILD, 'kadroskop.blob'),
      disableExperimentalSEAWarning: true,
      // Ресурсы лежат рядом с exe отдельными файлами, а не внутри: PresentMon
      // и сайдкар всё равно должны существовать на диске, чтобы их запустить.
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  ),
);

run(process.execPath, ['--experimental-sea-config', seaConfig], { shell: false });

clearOutputFolder();
mkdirSync(OUT, { recursive: true });

const exePath = join(OUT, EXE_NAME);
cpSync(process.execPath, exePath);

// postject неизбежно портит подпись Node: мы дописываем данные в подписанный
// exe. Убрать подпись заранее нечем — signtool входит в Windows SDK, которого
// на машине сборки может не быть. Для локального инструмента это безвредно,
// но SmartScreen на чужой машине будет ворчать громче.
process.stdout.write(
  'Подпись Node станет недействительной — так и должно быть при внедрении кода.\n',
);

run('npx', [
  'postject',
  exePath,
  'NODE_SEA_BLOB',
  join(BUILD, 'kadroskop.blob'),
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]);

// --- 5. Ресурсы рядом с exe -------------------------------------------------

step('Раскладываю ресурсы');
cpSync(join(ROOT, 'web', 'dist'), join(OUT, 'web'), { recursive: true });
cpSync(
  join(ROOT, 'src', 'infrastructure', 'windows', 'collect-snapshot.ps1'),
  join(OUT, 'collect-snapshot.ps1'),
);
cpSync(join(sidecarOut, 'kadroskop-sidecar.exe'), join(OUT, 'kadroskop-sidecar.exe'));

// Достаём сами, если его нет: единственный ручной шаг между «склонировал» и
// «работает» был именно здесь, а шаг, о котором надо помнить, однажды забудут.
const presentMon = await ensurePresentMon();
if (presentMon !== null) {
  cpSync(presentMon, join(OUT, 'PresentMon.exe'));
} else {
  process.stdout.write(
    'PresentMon получить не удалось — запись кадров в сборке работать не будет.\n' +
      'Положите его руками: tools/presentmon/README.md\n',
  );
}

writeFileSync(join(OUT, 'ЧИТАЙ.txt'), readmeText(), 'utf8');

step('Складываю архив для раздачи');
const archive = packForSharing();

step('Готово');
process.stdout.write(
  [
    `Версия: ${VERSION}`,
    `Папка со сборкой: ${OUT}`,
    archive === null ? null : `Архив для раздачи: ${archive}`,
    `Запуск: ${EXE_NAME}`,
    '',
  ]
    .filter((line) => line !== null)
    .join('\n'),
);

/**
 * Кладёт сборку в архив с версией в имени.
 *
 * Папку из шести файлов передать человеку нечем — её сначала надо чем-то
 * упаковать, и каждый упакует по-своему. Архив с версией в имени решает сразу
 * два вопроса: чем делиться и что именно тебе прислали.
 *
 * Настоящий одиночный exe был бы честнее по числу файлов, но он весит все 180
 * МБ, не подписан и распаковывает рядом с собой чужие исполняемые файлы, —
 * SmartScreen и антивирусы реагируют на такое заметно хуже, чем на архив.
 *
 * Не собрался — это не повод ронять сборку: папка на месте и работает.
 */
function packForSharing() {
  const path = join(ROOT, `kadroskop-${VERSION}.zip`);
  rmSync(path, { force: true });

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${OUT}${sep}*' -DestinationPath '${path}' -CompressionLevel Optimal -Force`,
    ],
    { stdio: 'inherit' },
  );

  if (result.status !== 0 || !existsSync(path)) {
    process.stderr.write('Архив собрать не удалось — раздавайте папку целиком.\n');
    return null;
  }
  return path;
}

/**
 * Очищает папку сборки.
 *
 * Если из неё сейчас запущено приложение, Windows не даст удалить файлы. Это
 * штатная ситуация, а не поломка сборки, и человеку надо сказать что делать —
 * а не показывать стектрейс из глубин fs.
 */
function clearOutputFolder() {
  try {
    rmSync(OUT, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EBUSY' && error.code !== 'ENOTEMPTY') {
      throw error;
    }
    process.stderr.write(
      [
        `Не удалось очистить ${OUT}: файлы заняты.`,
        'Скорее всего, из этой папки запущено приложение.',
        'Закройте kadroskop.exe и kadroskop-sidecar.exe — через диспетчер задач,',
        'если окна уже нет.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

function readmeText() {
  return [
    `кадроскоп ${VERSION} — диагностика потерь кадров`,
    '',
    'Запуск: kadroskop.exe (двойным щелчком). Откроется браузер.',
    '',
    'Ничего ставить не нужно: рантайм Node и .NET уже внутри.',
    '',
    'Запись кадров требует прав администратора — PresentMon читает события ETW.',
    'Чтобы не отвечать на запрос UAC каждый раз, запускайте kadroskop.exe',
    'через правую кнопку → «Запуск от имени администратора».',
    '',
    'Все файлы в этой папке нужны, переносите её целиком.',
    '',
  ].join('\n');
}
