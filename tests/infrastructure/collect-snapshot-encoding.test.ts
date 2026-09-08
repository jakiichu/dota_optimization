import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(
  new URL('../../src/infrastructure/windows/collect-snapshot.ps1', import.meta.url),
);

/**
 * Windows PowerShell 5.1 читает .ps1 без BOM как файл в кодовой странице ANSI.
 * Кириллица в скрипте при этом превращается в мусор, и скрипт падает на разборе.
 * Ошибка выглядит как «Unexpected token» в середине строкового литерала и стоит
 * получаса, поэтому проверяем байты, а не полагаемся на память.
 */
describe('collect-snapshot.ps1', () => {
  it('сохранён с BOM — иначе PowerShell 5.1 не разберёт кириллицу', () => {
    const head = readFileSync(SCRIPT).subarray(0, 3);

    expect([...head]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('не передаёт $null в строковые параметры WinAPI', () => {
    const source = readFileSync(SCRIPT, 'utf8');

    // PowerShell подменяет $null пустой строкой, и EnumDisplayDevices отказывает.
    expect(source).not.toMatch(/EnumDisplayDevices\(\$null/);
  });
});
