import type { Machine } from '../../domain/models.ts';

export type SectionId = 'audit' | 'capture' | 'compare' | 'sensors';

interface Section {
  readonly id: SectionId;
  readonly label: string;
  readonly hint: string;
}

const SECTIONS: readonly Section[] = [
  { id: 'audit', label: 'Аудит', hint: 'настройки, которые стоят кадров' },
  { id: 'capture', label: 'Запись кадров', hint: 'frametime, статтеры, ритм' },
  { id: 'compare', label: 'Сравнение', hint: 'до и после правки' },
  { id: 'sensors', label: 'Сенсоры', hint: 'живые показания' },
];

export function Sidebar({
  active,
  onSelect,
  machine,
  badges,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  machine: Machine | undefined;
  /** Значок у раздела: число находок, число записей. */
  badges: Readonly<Partial<Record<SectionId, string | undefined>>>;
}): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">frameloss</div>

      <nav className="sidebar-nav">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className="sidebar-item"
            aria-current={active === section.id}
            onClick={() => onSelect(section.id)}
          >
            <span className="sidebar-item-label">
              {section.label}
              {badges[section.id] !== undefined && (
                <span className="sidebar-badge">{badges[section.id]}</span>
              )}
            </span>
            <span className="sidebar-item-hint">{section.hint}</span>
          </button>
        ))}
      </nav>

      {/* Машина внизу и всегда на виду: без неё цифры не с чем соотнести. */}
      {machine !== undefined && (
        <div className="sidebar-machine">
          <div className="sidebar-machine-name">{machine.name}</div>
          <div>{machine.cpu}</div>
          <div>{machine.gpu}</div>
          <div>{machine.os}</div>
          {!machine.collectedAsAdmin && (
            <div className="sidebar-machine-warning">
              без прав администратора — часть проверок недоступна
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
