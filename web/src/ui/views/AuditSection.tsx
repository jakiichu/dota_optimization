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
import { Icon } from '../components/Icon.tsx';
import type { SectionId } from '../layout/Sidebar.tsx';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/States.tsx';

export function AuditSection({
  onNavigate,
}: {
  onNavigate: (section: SectionId) => void;
}): React.JSX.Element {
  const audit = useAudit();
  const [visible, setVisible] = useState<Set<Severity>>(new Set(DEFAULT_VISIBLE_SEVERITIES));

  if (audit.isPending) {
    return <LoadingState what="Проверяю систему и измеряю нагрузку — около 15–30 секунд…" />;
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

  const resources = audit.data.findings.filter((finding) =>
    finding.ruleId.startsWith('resources.'),
  );
  const shown = audit.data.findings.filter(
    (finding) => !finding.ruleId.startsWith('resources.') && visible.has(finding.severity),
  );

  const settingsCounts = { critical: 0, warning: 0, info: 0, unknown: 0, ok: 0 };
  for (const finding of audit.data.findings) {
    if (!finding.ruleId.startsWith('resources.')) settingsCounts[finding.severity] += 1;
  }

  return (
    <>
      <SectionHeader
        title="Обзор системы"
        subtitle="Проверьте настройки компьютера, затем измерьте плавность в игре."
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

      <section className="overview-hero" aria-label="Следующий шаг">
        <div className="hero-copy">
          <span className="eyebrow">ОТ НАСТРОЕК — К ИЗМЕРЕНИЯМ</span>
          <h2>
            Поймите, почему
            <br />
            игра дёргается.
          </h2>
          <p>
            Запишите минуту игры. Кадроскоп покажет долгие кадры, нагрузку и подскажет, что
            проверить дальше.
          </p>
          <button className="button primary" onClick={() => onNavigate('capture')}>
            Перейти к записи <Icon name="arrow" />
          </button>
          <span className="hero-footnote">Настройки не меняются автоматически</span>
        </div>
        <div className="hero-workflow" aria-label="Как пользоваться">
          <div>
            <span className="step-number">01</span>
            <div>
              <strong>Проверьте систему</strong>
              <p>Возможные проблемы уже собраны ниже.</p>
            </div>
          </div>
          <button onClick={() => onNavigate('capture')}>
            <span className="step-number">02</span>
            <div>
              <strong>Запишите игру</strong>
              <p>Посмотрите, что происходит во время рывков.</p>
            </div>
            <Icon name="chevron" />
          </button>
          <button onClick={() => onNavigate('compare')}>
            <span className="step-number">03</span>
            <div>
              <strong>Сравните результат</strong>
              <p>Измените одну настройку и повторите замер.</p>
            </div>
            <Icon name="chevron" />
          </button>
        </div>
      </section>

      {resources.length > 0 && (
        <section aria-labelledby="resource-check-title">
          <div className="section-divider">
            <h2 id="resource-check-title">Что можно улучшить</h2>
            <span>Память, диски и нагрузка программ</span>
          </div>
          <p className="muted">
            Снимок на {new Date(audit.data.machine.capturedAt).toLocaleTimeString('ru-RU')}. Для
            свежих данных нажмите «Проверить заново». Раскройте пункт, чтобы увидеть показатели и
            следующие шаги.
          </p>
          {resources.map((finding) => (
            <FindingCard key={finding.ruleId} finding={finding} />
          ))}
        </section>
      )}

      <div className="audit-stats">
        <div className="audit-stat" data-tone="warning">
          <span className="stat-marker" />
          <div>
            <span className="stat-label">Требуют внимания</span>
            <strong>{audit.data.counts.critical + audit.data.counts.warning}</strong>
            <span className="muted">Возможные причины проблем</span>
          </div>
        </div>
        <div className="audit-stat" data-tone="ok">
          <span className="stat-marker" />
          <div>
            <span className="stat-label">В порядке</span>
            <strong>{audit.data.counts.ok}</strong>
            <span className="muted">Проверки без замечаний</span>
          </div>
        </div>
        <div className="audit-stat" data-tone="unknown">
          <span className="stat-marker" />
          <div>
            <span className="stat-label">Не удалось проверить</span>
            <strong>{audit.data.counts.unknown}</strong>
            <span className="muted">Для вывода не хватает данных</span>
          </div>
        </div>
      </div>
      <div className="section-divider">
        <h2>Настройки системы</h2>
        <span>Нажмите на пункт, чтобы увидеть подробности</span>
      </div>

      <div className="summary">
        {SEVERITY_ORDER.filter((severity) => settingsCounts[severity] > 0).map((severity) => (
          <button
            key={severity}
            type="button"
            className="chip"
            aria-pressed={visible.has(severity)}
            onClick={() => toggle(severity)}
          >
            <span className="dot" style={{ background: SEVERITY_COLOR[severity] }} />
            {SEVERITY_LABEL[severity]}: {settingsCounts[severity]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState>
          {audit.data.findings.length === 0
            ? 'Пока нет результатов проверки.'
            : 'В выбранных категориях нет пунктов. Включите другую категорию выше.'}
        </EmptyState>
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
