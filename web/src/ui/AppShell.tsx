import { SessionRecap } from './components/SessionRecap.tsx';
import { AutoRecording } from './components/AutoRecording.tsx';
import { useCallback, useEffect, useState } from 'react';
import { useAudit, useSessions, useVersion, useSessionAnalysis } from '../application/queries.ts';
import { LoadingBar } from './layout/LoadingBar.tsx';
import { Sidebar, type SectionId } from './layout/Sidebar.tsx';
import type { ConfigChange } from '../domain/models.ts';
import { AuditSection } from './views/AuditSection.tsx';
import { CaptureSection } from './views/CaptureSection.tsx';
import { ConfigSection } from './views/ConfigSection.tsx';
import { CompareSection } from './views/CompareSection.tsx';
import { SensorsSection } from './views/SensorsSection.tsx';
import { ExperimentGuide } from './components/ExperimentGuide.tsx';
import { useCaptureController } from '../application/use-capture-controller.ts';
import { CaptureStatusBar } from './components/CaptureStatusBar.tsx';

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
  const recorder = useCaptureController();
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(null);
  useEffect(() => setRequestedSessionId(null), [recorder.status.data?.sessionId]);

  /**
   * Изменение, с которым пришли из рекомендации.
   *
   * Живёт здесь, а не в разделе записи: раздел с рекомендацией размонтируется
   * ровно в тот момент, когда человек по ней и переходит. Оболочка переживает
   * переключение и потому годится в посредники.
   */
  const [proposed, setProposed] = useState<readonly ConfigChange[]>([]);
  const [configDraft, setConfigDraft] = useState<Record<string, string | null>>({});

  const openInConfig = useCallback((changes: readonly ConfigChange[]): void => {
    setProposed(changes);
    setSection('config');
  }, []);

  const forgetProposal = useCallback(() => setProposed([]), []);

  // Оба запроса читаются из кеша: здесь они нужны только ради значков в меню и
  // сведений о машине, и своего сетевого обращения не добавляют.
  const audit = useAudit();
  const version = useVersion();
  const sessions = useSessions();
  const latestId = recorder.status.data?.sessionId ?? sessions.data?.[0]?.id ?? null;
  const latest = useSessionAnalysis(recorder.recording ? null : latestId);

  const actionable =
    audit.data === undefined ? undefined : audit.data.counts.critical + audit.data.counts.warning;

  return (
    <div className="app">
      <LoadingBar />

      <Sidebar
        active={section}
        onSelect={(next) => {
          setRequestedSessionId(null);
          setSection(next);
        }}
        machine={audit.data?.machine}
        version={version.data}
        badges={{
          audit: actionable !== undefined && actionable > 0 ? String(actionable) : undefined,
          compare: sessions.data === undefined ? undefined : String(sessions.data.length),
        }}
      />

      <main className="content">
        <div className="workspace-topbar">
          <span>ДИАГНОСТИКА ПРОИЗВОДИТЕЛЬНОСТИ</span>
          <span className="game-tag">
            Dota 2 <span className="muted">/ Windows</span>
          </span>
        </div>
        <CaptureStatusBar recorder={recorder} onOpen={() => setSection('capture')} />
        <ExperimentGuide onNavigate={setSection} onOpenInConfig={openInConfig} />
        {section === 'audit' && latest.data && !recorder.recording && (
          <SessionRecap
            capture={latest.data}
            onOpen={() => {
              setRequestedSessionId(latest.data!.sessionId);
              setSection('capture');
            }}
          />
        )}
        {section === 'audit' && <AuditSection onNavigate={setSection} />}
        {section === 'capture' && (
          <>
            <AutoRecording />
            <CaptureSection
              requestedSessionId={requestedSessionId}
              recorder={recorder}
              onOpenInConfig={openInConfig}
            />
          </>
        )}
        {section === 'config' && (
          <ConfigSection
            proposed={proposed}
            onProposalTaken={forgetProposal}
            draft={configDraft}
            setDraft={setConfigDraft}
          />
        )}
        {section === 'compare' && <CompareSection onCapture={() => setSection('capture')} />}
        {section === 'sensors' && <SensorsSection />}
      </main>
    </div>
  );
}
