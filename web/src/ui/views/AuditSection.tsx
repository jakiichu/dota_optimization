import { useState } from 'react';
import { useAudit } from '../../application/queries.ts';
import type { Severity } from '../../domain/models.ts';
import {
  DEFAULT_VISIBLE_SEVERITIES,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
} from '../../domain/presentation.ts';
import { FindingCard } from '../components/FindingCard.tsx';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/States.tsx';

export function AuditSection(): React.JSX.Element {
  const audit = useAudit();
  const [visible, setVisible] = useState<Set<Severity>>(
    new Set(DEFAULT_VISIBLE_SEVERITIES),
  );

  if (audit.isPending) {
    return <LoadingState what="Собираю снимок системы…" />;
  }

  if (audit.isError) {
    return <ErrorState message={audit.error.message} onRetry={() => void audit.refetch()} />;
  }

  const toggle = (severity: Severity): void => {
    const next = new Set(visible);
    if (next.has(severity)) next.delete(severity);
    else next.add(severity);
    setVisible(next);
  };

  const shown = audit.data.findings.filter((finding) => visible.has(finding.severity));

  return (
    <>
      <SectionHeader
        title="Аудит конфигурации"
        subtitle="настройки, которые стоят кадров"
        stale={audit.isFetching}
      >
        <button
          type="button"
          className="button"
          onClick={() => void audit.refetch()}
          disabled={audit.isFetching}
        >
          {audit.isFetching ? 'Проверяю…' : 'Проверить заново'}
        </button>
      </SectionHeader>

      <div className="summary">
        {SEVERITY_ORDER.filter((severity) => audit.data.counts[severity] > 0).map(
          (severity) => (
            <button
              key={severity}
              type="button"
              className="chip"
              aria-pressed={visible.has(severity)}
              onClick={() => toggle(severity)}
            >
              <span className="dot" style={{ background: SEVERITY_COLOR[severity] }} />
              {SEVERITY_LABEL[severity]}: {audit.data.counts[severity]}
            </button>
          ),
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState>Ничего не показано — включите категории выше.</EmptyState>
      ) : (
        shown.map((finding) => <FindingCard key={finding.ruleId} finding={finding} />)
      )}

      {audit.data.collectionErrors.length > 0 && (
        <div className="errors">
          Не удалось собрать:
          <ul>
            {audit.data.collectionErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
