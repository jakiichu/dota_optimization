import { useState } from 'react';
import { useAudit, useSessions } from '../application/queries.ts';
import { LoadingBar } from './layout/LoadingBar.tsx';
import { Sidebar, type SectionId } from './layout/Sidebar.tsx';
import { AuditSection } from './views/AuditSection.tsx';
import { CaptureSection } from './views/CaptureSection.tsx';
import { CompareSection } from './views/CompareSection.tsx';
import { SensorsSection } from './views/SensorsSection.tsx';

/**
 * Оболочка приложения.
 *
 * Разделы держатся в кеше запросов, а не в живых компонентах: переключение
 * туда-обратно не должно стоить нового сбора данных. Поэтому неактивные
 * разделы размонтируются — и вместе с сенсорами уходит процесс сайдкара,
 * который не нужен, пока на них не смотрят.
 */
export function AppShell(): React.JSX.Element {
  const [section, setSection] = useState<SectionId>('audit');

  // Оба запроса читаются из кеша: здесь они нужны только ради значков в меню и
  // сведений о машине, и своего сетевого обращения не добавляют.
  const audit = useAudit();
  const sessions = useSessions();

  const actionable =
    audit.data === undefined
      ? undefined
      : audit.data.counts.critical + audit.data.counts.warning;

  return (
    <div className="app">
      <LoadingBar />

      <Sidebar
        active={section}
        onSelect={setSection}
        machine={audit.data?.machine}
        badges={{
          audit: actionable !== undefined && actionable > 0 ? String(actionable) : undefined,
          compare: sessions.data === undefined ? undefined : String(sessions.data.length),
        }}
      />

      <main className="content">
        {section === 'audit' && <AuditSection />}
        {section === 'capture' && <CaptureSection />}
        {section === 'compare' && <CompareSection />}
        {section === 'sensors' && <SensorsSection />}
      </main>
    </div>
  );
}
