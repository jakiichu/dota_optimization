import { useState } from 'react';
import type { Finding } from '../../domain/models.ts';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../../domain/presentation.ts';

/** Шаг починки, который выглядит как команда, стоит уметь скопировать одной кнопкой. */
function looksLikeCommand(step: string): boolean {
  return /^(reg |powercfg |bcdedit |dotnet |npm |node )/.test(step);
}

function CopyableStep({ step }: { step: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  if (!looksLikeCommand(step)) {
    return <li>{step}</li>;
  }

  const copy = (): void => {
    void navigator.clipboard.writeText(step).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <li>
      <div className="step-command">
        <code>{step}</code>
        <button type="button" className="copy" onClick={copy}>
          {copied ? 'скопировано' : 'копировать'}
        </button>
      </div>
    </li>
  );
}

export function FindingCard({ finding }: { finding: Finding }): React.JSX.Element {
  const [open, setOpen] = useState(finding.severity === 'critical');

  return (
    <article className="finding" data-severity={finding.severity}>
      <div
        className="finding-head"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setOpen(!open);
        }}
      >
        <span className="dot" style={{ background: SEVERITY_COLOR[finding.severity] }} />
        <span className="finding-title">{finding.title}</span>
        <span className="finding-id">
          {SEVERITY_LABEL[finding.severity]} · {finding.ruleId}
        </span>
      </div>
      <div className="finding-summary">{finding.summary}</div>

      {open && (
        <div className="finding-body">
          <dl className="kv">
            <dt>сейчас</dt>
            <dd>{finding.observed}</dd>
            {finding.expected !== '' && (
              <>
                <dt>должно</dt>
                <dd>{finding.expected}</dd>
              </>
            )}
            {finding.impact !== '' && (
              <>
                <dt>почему</dt>
                <dd>{finding.impact}</dd>
              </>
            )}
          </dl>

          {finding.remediation.length > 0 && (
            <ol className="steps">
              {finding.remediation.map((step) => (
                <CopyableStep key={step} step={step} />
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}
