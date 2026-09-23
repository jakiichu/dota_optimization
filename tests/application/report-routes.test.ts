import { describe, expect, it, vi } from 'vitest';
import { createReportExportRoute } from '../../src/main/report-routes.ts';

describe('маршрут экспорта отчёта', () => {
  it('сохраняет проверенный автономный HTML и возвращает путь', async () => {
    const save = vi.fn(async () => 'C:\\Desktop\\kadroskop-report.html');
    const html = '<!doctype html><meta charset="utf-8"><h1>Кадроскоп</h1>';
    const result = await createReportExportRoute(save).handle(
      new URLSearchParams(),
      JSON.stringify({ html }),
    );

    expect(save).toHaveBeenCalledWith(html);
    expect(result).toEqual({ path: 'C:\\Desktop\\kadroskop-report.html' });
  });

  it.each([
    ['не HTML', JSON.stringify({ html: 'текст' })],
    ['скрипт', JSON.stringify({ html: '<!doctype html><script>alert(1)</script>' })],
    [
      'внешний адрес',
      JSON.stringify({ html: '<!doctype html><a href="https://example.com">x</a>' }),
    ],
    ['битый JSON', '{'],
  ])('отвергает опасное или неверное содержимое: %s', async (_name, body) => {
    const save = vi.fn(async () => 'unused');
    await expect(
      createReportExportRoute(save).handle(new URLSearchParams(), body),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it('ограничивает размер до записи файла', async () => {
    const save = vi.fn(async () => 'unused');
    const body = JSON.stringify({ html: `<!doctype html>${'x'.repeat(512 * 1024)}` });
    await expect(createReportExportRoute(save).handle(new URLSearchParams(), body)).rejects.toThrow(
      'слишком большой',
    );
    expect(save).not.toHaveBeenCalled();
  });
});
