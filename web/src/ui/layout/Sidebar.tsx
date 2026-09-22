import type {Machine} from '../../domain/models.ts';
import {Icon, type IconName} from '../components/Icon.tsx';

export type SectionId = 'audit' | 'capture' | 'config' | 'compare' | 'sensors';

interface Section {
    readonly id: SectionId;
    readonly label: string;
    readonly hint: string;
    readonly icon: IconName;
}

const SECTIONS: readonly Section[] = [
    {id: 'audit', label: 'Обзор системы', hint: 'Что стоит проверить', icon: 'overview'},
    {id: 'capture', label: 'Запись и разбор', hint: 'Найдите причину рывков', icon: 'capture'},
    {id: 'config', label: 'Настройки Dota', hint: 'Конфиг и управление', icon: 'settings'},
    {id: 'compare', label: 'Сравнение', hint: 'Помогли ли изменения', icon: 'compare'},
    {id: 'sensors', label: 'Мониторинг', hint: 'Нагрузка в реальном времени', icon: 'activity'},
];

export function Sidebar({
                            active,
                            onSelect,
                            machine,
                            badges,
                            version,
                        }: {
    active: SectionId;
    onSelect: (id: SectionId) => void;
    machine: Machine | undefined;
    /** Версия сборки. `undefined` — ещё не спросили. */
    version: string | undefined;
    /** Значок у раздела: число находок, число записей. */
    badges: Readonly<Partial<Record<SectionId, string | undefined>>>;
}): React.JSX.Element {
    return (
        <aside className="sidebar">
            <div className="sidebar-brand"><span className="brand-symbol"><Icon name="activity"/></span>
                <div>кадроскоп</div>
            </div>
            <div className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>

            <nav className="sidebar-nav" aria-label="Разделы приложения">
                {SECTIONS.map((section) => (
                    <button
                        key={section.id}
                        type="button"
                        className="sidebar-item"
                        aria-current={active === section.id ? 'page' : undefined}
                        onClick={() => onSelect(section.id)}
                    >
                        <Icon name={section.icon} className="sidebar-icon"/>
                        <span className="sidebar-item-content"><span className="sidebar-item-label">
              {section.label}
                            {badges[section.id] !== undefined && badges[section.id] !== '0' && (
                                <span className="sidebar-badge">{badges[section.id]}</span>
                            )}
            </span>
            <span className="sidebar-item-hint">{section.hint}</span>
            </span>
                    </button>
                ))}
            </nav>

            {/* Машина внизу и всегда на виду: без неё цифры не с чем соотнести. */}
            {machine !== undefined && (
                <div className="sidebar-machine">
                    <span className="nav-caption">ВАШ КОМПЬЮТЕР</span>
                    <details className="machine-details">
                        <summary className="sidebar-machine-name">{machine.name}</summary>
                        <div>{machine.cpu}</div>
                        <div>{machine.gpu}</div>
                        <div>{machine.os}</div>
                    </details>
                    {!machine.collectedAsAdmin && (
                        <div className="sidebar-machine-warning">
                            без прав администратора — часть проверок недоступна
                        </div>
                    )}
                </div>
            )}

            {/* Версия внизу и всегда на виду: сборку раздают людям, и первый вопрос
          к чужому отчёту — «а версия какая». */}
            {version !== undefined && <div className="sidebar-version">кадроскоп {version}</div>}
        </aside>
    );
}
