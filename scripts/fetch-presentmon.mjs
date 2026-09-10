import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Достаёт PresentMon, если его ещё нет.
 *
 * Раньше это был единственный ручной шаг между «склонировал» и «работает»:
 * сборка предупреждала «PresentMon.exe не найден — запись кадров работать не
 * будет», и человек шёл читать README. Шаг, о котором надо помнить, — это шаг,
 * который однажды забудут.
 *
 * **Скачиваем ровно один известный файл.** Версия, размер и SHA-256 прибиты
 * здесь же: не «последний релиз», а тот, на котором инструмент проверялся.
 * Плавающая версия означала бы, что завтра к нам приедет чужой бинарник, о
 * котором мы ничего не знаем, — и приедет молча.
 *
 * **Проверяем трижды**: длину, контрольную сумму и подпись Intel. Несовпадение
 * любой — файл удаляется и сборка падает. Скачать исполняемый файл и запустить
 * его, не посмотрев, что приехало, нельзя ни при каких удобствах.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Эталонная версия. Та же, что описана в tools/presentmon/README.md. */
const VERSION = '2.5.1';

const TARGET = join(ROOT, 'tools', 'presentmon', 'PresentMon.exe');

const URL =
  `https://github.com/GameTechDev/PresentMon/releases/download/v${VERSION}/` +
  `PresentMon-${VERSION}-x64.exe`;

const SIZE_BYTES = 956_768;

const SHA256 = '9bec3083069f58f911e6a512f4806db51a27bd096103087bc1d05ef54c80a191';

/** Кем файл подписан. Проверяется только на Windows — там же он и нужен. */
const SIGNER = 'Intel Corporation';

export function presentMonPath() {
  return TARGET;
}

/**
 * Возвращает путь к PresentMon, скачав его при необходимости.
 *
 * @param {{ quiet?: boolean }} options
 * @returns {Promise<string | null>} `null` — не получилось; звать не надо, но и
 *   ронять всё приложение из-за этого незачем: аудит и показания работают.
 */
export async function ensurePresentMon({ quiet = false } = {}) {
  if (existsSync(TARGET) && verify(TARGET, { quiet: true })) return TARGET;

  const say = (message) => {
    if (!quiet) process.stdout.write(`${message}\n`);
  };

  say(`Скачиваю PresentMon ${VERSION} (${(SIZE_BYTES / 1024).toFixed(0)} КиБ) от Intel:`);
  say(`  ${URL}`);

  let bytes;
  try {
    const response = await fetch(URL, { redirect: 'follow' });
    if (!response.ok) {
      say(`Не получилось: сервер ответил ${response.status}.`);
      return null;
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    say(`Не получилось: ${error.message}`);
    return null;
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, bytes);

  if (!verify(TARGET, { quiet })) {
    // Непроверенный исполняемый файл на диске опаснее его отсутствия: в
    // следующий раз он уже выглядел бы как «просто лежит здесь».
    rmSync(TARGET, { force: true });
    return null;
  }

  say('PresentMon на месте: размер, контрольная сумма и подпись сошлись.');
  return TARGET;
}

/** Тот ли это файл: длина, сумма, подпись. */
function verify(path, { quiet }) {
  const say = (message) => {
    if (!quiet) process.stderr.write(`${message}\n`);
  };

  const bytes = readFileSync(path);
  if (bytes.length !== SIZE_BYTES) {
    say(`PresentMon: длина ${bytes.length} вместо ${SIZE_BYTES}.`);
    return false;
  }

  const sum = createHash('sha256').update(bytes).digest('hex');
  if (sum !== SHA256) {
    say(`PresentMon: SHA-256 ${sum} вместо ${SHA256}.`);
    return false;
  }

  const signer = authenticodeSigner(path);
  // `null` — проверить нечем (не Windows, нет PowerShell). Сумма уже сошлась,
  // и останавливаться только из-за недоступной проверки незачем.
  if (signer !== null && !signer.includes(SIGNER)) {
    say(`PresentMon: подписан «${signer}», а ожидался «${SIGNER}».`);
    return false;
  }

  return true;
}

function authenticodeSigner(path) {
  if (process.platform !== 'win32') return null;

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$s = Get-AuthenticodeSignature -LiteralPath '${path}';` +
        'if ($s.Status -ne "Valid") { exit 1 };' +
        '$s.SignerCertificate.Subject',
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) return result.status === 1 ? 'подпись недействительна' : null;
  return result.stdout.trim();
}

// Запуск напрямую: `node scripts/fetch-presentmon.mjs`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = await ensurePresentMon();
  process.exit(path === null ? 1 : 0);
}
