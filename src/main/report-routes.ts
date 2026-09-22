import type { JsonRoute } from '../infrastructure/http/local-server.ts';

const MAX_REPORT_BYTES = 512 * 1024;

export type SaveReport = (html: string) => Promise<string>;

/** Сохраняет уже подготовленный локальным интерфейсом обезличенный отчёт. */
export function createReportExportRoute(save: SaveReport): JsonRoute {
  return {
    path: '/api/reports/export',
    method: 'POST',
    async handle(_query, body) {
      const html = htmlFrom(body);
      return { path: await save(html) };
    },
  };
}

function htmlFrom(body: string): string {
  if (Buffer.byteLength(body, 'utf8') > MAX_REPORT_BYTES) {
    throw new Error('Отчёт слишком большой для сохранения.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Тело запроса не похоже на JSON.');
  }
  const html = (parsed as { html?: unknown }).html;
  if (typeof html !== 'string' || !/^<!doctype html>/i.test(html.trim())) {
    throw new Error('В запросе нет готового HTML-отчёта.');
  }
  if (/<script\b/i.test(html) || /https?:\/\//i.test(html)) {
    throw new Error('Отчёт содержит скрипт или внешний адрес и не будет сохранён.');
  }
  return html;
}
