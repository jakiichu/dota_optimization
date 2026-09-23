import { useMemo, useState } from 'react';
import { useReportExport } from '../../application/use-report-export.ts';
import { createSessionReport } from '../../domain/session-report.ts';
import type { Capture } from '../../domain/models.ts';

export function ReportExportPanel({ capture }: { capture: Capture }): React.JSX.Element {
  const [opened, setOpened] = useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Отчёт для отправки</span>
        <button
          type="button"
          className="button"
          aria-expanded={opened}
          onClick={() => setOpened((value) => !value)}
        >
          {opened ? 'Закрыть предпросмотр' : 'Подготовить отчёт'}
        </button>
      </div>
      {opened && <ReportPreview capture={capture} />}
    </div>
  );
}

function ReportPreview({ capture }: { capture: Capture }): React.JSX.Element {
  const [chart, setChart] = useState(true);
  const [inputLatency, setInputLatency] = useState(false);
  const report = useMemo(
    () => createSessionReport(capture, { chart, inputLatency }),
    [capture, chart, inputLatency],
  );
  const exporter = useReportExport();
  return (
    <>
      <p className="muted">
        В файл попадут показатели всей записи и пояснения. Название компьютера, подпись записи,
        пути, конфиг и список программ не включаются. Отчёт откроется без интернета.
      </p>
      <div className="capture-form">
        <label>
          <input type="checkbox" checked={chart} onChange={(e) => setChart(e.target.checked)} />
          График времени кадра
        </label>
        <label>
          <input
            type="checkbox"
            checked={inputLatency}
            onChange={(e) => setInputLatency(e.target.checked)}
          />
          Показатели задержки ввода
        </label>
        <button
          type="button"
          className="button primary"
          disabled={exporter.pending}
          onClick={() => exporter.save(report)}
        >
          {exporter.pending ? 'Сохраняю…' : 'Сохранить на рабочий стол'}
        </button>
      </div>
      {exporter.error !== null && <p className="notice error">{exporter.error}</p>}
      {exporter.path !== null && (
        <p className="notice">
          Отчёт сохранён: <code>{exporter.path}</code>
        </p>
      )}
      <iframe title="Предпросмотр отчёта" sandbox="" srcDoc={report} className="report-preview" />
    </>
  );
}
