import { describe, expect, it } from 'vitest';
import { createSessionReport } from '../../web/src/domain/session-report.ts';
import { reportCapture } from '../support/report-builder.ts';

describe('отчёт о записи', () => {
  it('содержит показатели и ограничения, открывается без внешних ресурсов', () => {
    const html = createSessionReport(reportCapture(), { chart: true, inputLatency: true });
    expect(html).toContain('p99 кадра');
    expect(html).toContain('<svg');
    expect(html).toContain('Самые длинные статтеры');
    expect(html).toContain('Одна запись не показывает эффект настройки');
    expect(html).not.toMatch(/<script|https?:\/\/|<link|<iframe/i);
  });

  it('не включает произвольные тексты, пути и идентификаторы записи', () => {
    const source = reportCapture();
    const secret = 'PRIVATE_USER_C:\\Users\\Secret\\<script>alert(1)</script>';
    const html = createSessionReport({ ...source, application: secret, sessionId: secret,
      background: [{ name: secret, usualPercent: 5, peakPercent: 10 }],
      bottleneck: { ...source.bottleneck, explanation: secret },
      series: { ...source.series, stutterMarks: [{ index: 0, frameIndex: 0, atSeconds: 0, frameTimeMs: 100, kind: null, evidence: [secret] }] },
      recommendations: source.recommendations.map((r) => ({ ...r, evidence: secret, title: secret })),
    }, { chart: true, inputLatency: true });
    expect(html).not.toContain('PRIVATE_USER');
    expect(html).not.toContain('private-session-id');
    expect(html).not.toContain('alert(1)');
  });

  it('исключает отключённые разделы из скачиваемого содержимого', () => {
    const html = createSessionReport(reportCapture(), { chart: false, inputLatency: false });
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<h2>Задержка ввода');
    expect(html).toContain('Основные показатели');
  });

  it('сохраняет редкий высокий пик при сокращении графика', () => {
    const times = Array<number>(10000).fill(10);
    times[5555] = 500;
    const html = createSessionReport(reportCapture(times), { chart: true, inputLatency: false });
    expect(html).toContain('500.0 мс');
    expect(html).toContain('без усреднения пиков');
    const points = /<polyline points="([^"]+)"/.exec(html)?.[1]?.split(' ') ?? [];
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(1602);
    expect(points.some((point) => point.endsWith(',30.00'))).toBe(true);
  });

  it('не рисует нечисловые точки и не выдаёт пропущенные показатели за ноль', () => {
    const source = reportCapture();
    const html = createSessionReport({ ...source, averageFps: NaN, inputLatency: null,
      series: { ...source.series, time: [NaN, 1, 2], frameTimeMs: [10, Infinity, 20] },
    }, { chart: true, inputLatency: true });
    expect(html).toContain('Недостаточно точек');
    expect(html).toContain('p99: — мс');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
