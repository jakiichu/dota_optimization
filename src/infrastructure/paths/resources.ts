import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Где лежат файлы, которые приложению нужны в работе: скрипт сбора, сайдкар,
 * PresentMon, собранный интерфейс.
 *
 * Мест два и они разные. В разработке всё лежит в дереве исходников, и путь
 * считается от этого модуля. В собранном exe исходников нет вовсе: код запечён
 * внутрь, а файлы лежат рядом с ним. Поэтому резолвер один на всё приложение —
 * иначе половина путей переживёт упаковку, а половина нет, и выяснится это уже
 * на чужой машине.
 */

/**
 * Флаг, который подставляет сборщик.
 *
 * Объявлен, но нигде не определён: в разработке идентификатора не существует,
 * поэтому проверять его можно только через `typeof`. В сборке esbuild заменяет
 * его на `true` ещё до выполнения.
 */
declare const FRAMELOSS_PACKAGED: boolean;

/**
 * Запущены ли мы как собранный exe.
 *
 * Раньше признаком служил пустой `import.meta.url`: в CommonJS-бандле его не
 * существует. Работало, но опиралось на побочный эффект сборки, а такие опоры
 * ломаются молча. Теперь сборщик говорит об этом прямо, а проверка пустого
 * `import.meta` осталась запасной — на случай сборки без флага.
 */
const PACKAGED = ((): boolean => {
  if (typeof FRAMELOSS_PACKAGED !== 'undefined' && FRAMELOSS_PACKAGED) return true;
  const moduleUrl: string | undefined = import.meta.url;
  return moduleUrl === undefined || moduleUrl === '';
})();

/** Корень дерева исходников. В сборке не используется. */
const SOURCE_ROOT = PACKAGED
  ? ''
  : // Этот файл лежит в src/infrastructure/paths — отсюда три уровня вверх.
    resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const ROOT = PACKAGED ? dirname(process.execPath) : SOURCE_ROOT;

/** Абсолютный путь к ресурсу приложения. */
export function resourcePath(...segments: readonly string[]): string {
  return join(ROOT, ...segments);
}

/** Корень, от которого считаются ресурсы. Нужен для внятных сообщений об ошибках. */
export function resourceRoot(): string {
  return ROOT;
}

export function isPackaged(): boolean {
  return PACKAGED;
}

/**
 * Пути к внешним программам и файлам.
 *
 * В сборке они лежат рядом с exe плоско, в дереве исходников — по своим
 * каталогам. Разница спрятана здесь, чтобы вызывающий код о ней не знал.
 */
export const RESOURCES = {
  sidecar: (): string =>
    PACKAGED
      ? resourcePath('frameloss-sidecar.exe')
      : resourcePath('sidecar', 'bin', 'frameloss-sidecar.exe'),
  presentMon: (): string =>
    PACKAGED
      ? resourcePath('PresentMon.exe')
      : resourcePath('tools', 'presentmon', 'PresentMon.exe'),
  collectSnapshotScript: (): string =>
    PACKAGED
      ? resourcePath('collect-snapshot.ps1')
      : resourcePath('src', 'infrastructure', 'windows', 'collect-snapshot.ps1'),
  webRoot: (): string => (PACKAGED ? resourcePath('web') : resourcePath('web', 'dist')),
  /** Записи кладём рядом с приложением, а не в профиль: папку носят целиком. */
  sessionsRoot: (): string => resourcePath('sessions'),
} as const;
