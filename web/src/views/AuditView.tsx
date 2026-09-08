import { useCallback, useEffect, useState } from 'react';
import { fetchAudit, type AuditView as AuditData, type Severity } from '../api.ts';
import { FindingCard } from '../components/FindingCard.tsx';
import { DEFAULT_VISIBLE, SEVERITY_COLOR, SEVERITY_LABEL, SEVERITY_ORDER } from '../severity.ts';

export function AuditView({
  onMachine,
}: {
  onMachine: (machine: AuditData['machine'] | null) => void;
}): React.JSX.Element {
  const [data, setData] = useState<AuditData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState<Set<Severity>>(new Set(DEFAULT_VISIBLE));

  const load = useCallback(
    (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      fetchAudit(signal)
        .then((audit) => {
          setData(audit);
          onMachine(audit.machine);
        })
        .catch((cause: unknown) => {
          if (signal.aborted) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    },
    [onMachine],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const toggle = (severity: Severity): void => {
    const next = new Set(visible);
    if (next.has(severity)) next.delete(severity);
    else next.add(severity);
    setVisible(next);
  };

  const rerun = (): void => load(new AbortController().signal);

  if (error !== null) {
    return (
      <>
        <div className="notice error">{error}</div>
        <button type="button" className="button" onClick={rerun}>
          Повторить
        </button>
      </>
    );
  }

  if (data === null) {
    return <div className="notice">Собираю снимок системы…</div>;
  }

  const shown = data.findings.filter((finding) => visible.has(finding.severity));

  return (
    <>
      {!data.machine.collectedAsAdmin && (
        <div className="notice">
          Запущено без прав администратора — часть проверок недоступна.
        </div>
      )}

      <div className="summary">
        {SEVERITY_ORDER.filter((severity) => data.counts[severity] > 0).map((severity) => (
          <button
            key={severity}
            type="button"
            className="chip"
            aria-pressed={visible.has(severity)}
            onClick={() => toggle(severity)}
          >
            <span className="dot" style={{ background: SEVERITY_COLOR[severity] }} />
            {SEVERITY_LABEL[severity]}: {data.counts[severity]}
          </button>
        ))}
        <div className="actions" style={{ marginLeft: 'auto' }}>
          <button type="button" className="button" onClick={rerun} disabled={loading}>
            {loading ? 'Проверяю…' : 'Проверить заново'}
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="notice">Ничего не показано — включите категории выше.</div>
      ) : (
        shown.map((finding) => <FindingCard key={finding.ruleId} finding={finding} />)
      )}

      {data.collectionErrors.length > 0 && (
        <div className="errors">
          Не удалось собрать:
          <ul>
            {data.collectionErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
