import { useCallback, useState } from 'react';
import type { MachineView } from './api.ts';
import { AuditView } from './views/AuditView.tsx';
import { SensorsView } from './views/SensorsView.tsx';

type Tab = 'audit' | 'sensors';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'audit', label: 'Аудит' },
  { id: 'sensors', label: 'Сенсоры' },
];

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('audit');
  const [machine, setMachine] = useState<MachineView | null>(null);

  // Стабильная ссылка: иначе AuditView перезапускал бы аудит на каждый рендер.
  const handleMachine = useCallback((next: MachineView | null) => setMachine(next), []);

  return (
    <div className="app">
      <header className="header">
        <h1>frameloss</h1>
        {machine !== null && (
          <div className="machine">
            {machine.name} · {machine.cpu} · {machine.gpu} · {machine.os}
          </div>
        )}
      </header>

      <nav className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tab"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {/* Вкладка сенсоров размонтируется вместе с подпиской: пока на неё не
          смотрят, процесс сайдкара не нужен. */}
      {tab === 'audit' ? <AuditView onMachine={handleMachine} /> : <SensorsView />}
    </div>
  );
}
