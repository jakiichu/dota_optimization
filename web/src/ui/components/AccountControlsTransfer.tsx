import { useEffect, useState } from 'react';
import { useAccountControls } from '../../application/queries.ts';
import type { SteamControlProfile } from '../../domain/models.ts';

export function AccountControlsTransfer(): React.JSX.Element {
  const { profiles, transfer } = useAccountControls();
  const [sourceChoice, setSourceChoice] = useState('');
  const [targetChoice, setTargetChoice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const available = profiles.data?.profiles ?? [];
  const sourceId = sourceChoice || suggestedSource(available)?.id || '';
  const targetId = targetChoice || available.find((profile) => profile.id !== sourceId)?.id || '';
  const source = available.find((profile) => profile.id === sourceId) ?? null;
  const target = available.find((profile) => profile.id === targetId) ?? null;

  useEffect(() => setConfirming(false), [sourceId, targetId]);
  const canTransfer = source !== null && source.hasControls && target !== null && source.id !== target.id;

  return <div className="card account-transfer">
    <div className="card-head">
      <span className="card-title">Перенос управления между аккаунтами</span>
      <span className="card-note">только клавиши и быстрые команды Dota</span>
    </div>

    {profiles.isPending && <div className="muted">Ищу локальные аккаунты Steam…</div>}
    {profiles.isError && <div className="notice error">{profiles.error.message}
      <button type="button" className="button" onClick={() => void profiles.refetch()}>Повторить</button>
    </div>}
    {profiles.data !== undefined && available.length < 2 && <div className="muted">
      Для переноса нужны хотя бы два локальных Steam-аккаунта, на которых запускали Dota.
    </div>}

    {available.length >= 2 && <>
      <div className="account-transfer-grid">
        <AccountSelect label="Откуда" value={sourceId} profiles={available}
          onChange={(value) => { setSourceChoice(value); transfer.reset(); }} />
        <span className="account-transfer-arrow" aria-hidden="true">→</span>
        <AccountSelect label="Куда" value={targetId} profiles={available}
          onChange={(value) => { setTargetChoice(value); transfer.reset(); }} />
      </div>

      {source !== null && !source.hasControls && <div className="notice error">
        У аккаунта «{source.label}» пока нет сохранённой раскладки Dota.
      </div>}

      {!confirming ? <button type="button" className="button"
        disabled={!canTransfer} onClick={() => setConfirming(true)}>
        Проверить перенос
      </button> : <div className="account-transfer-confirm">
        <strong>{source?.label} → {target?.label}</strong>
        <span>Будет заменён только файл персональной раскладки клавиш.</span>
        <span>{target?.hasControls
          ? 'Текущая раскладка получателя сохранится рядом в резервной копии.'
          : 'У получателя ещё нет раскладки — резервная копия не требуется.'}</span>
        <span className="muted">Закройте Dota перед переносом, чтобы Steam Cloud не вернул старый файл при выходе из игры.</span>
        <div className="recommendation-actions">
          <button type="button" className="button primary" disabled={transfer.isPending}
            onClick={() => transfer.mutate({ sourceId, targetId }, { onSuccess: () => setConfirming(false) })}>
            {transfer.isPending ? 'Переношу…' : 'Перенести управление'}
          </button>
          <button type="button" className="button" disabled={transfer.isPending}
            onClick={() => setConfirming(false)}>Отмена</button>
        </div>
      </div>}
    </>}

    {transfer.isError && <div className="notice error">{transfer.error.message}</div>}
    {transfer.data !== undefined && <div className="notice">
      Управление перенесено: {transfer.data.source.label} → {transfer.data.target.label}.
      {transfer.data.backupPath !== null && <> Прежняя раскладка сохранена: <code>{transfer.data.backupPath}</code>.</>}
    </div>}
  </div>;
}

function AccountSelect({ label, value, profiles, onChange }: {
  label: string;
  value: string;
  profiles: readonly SteamControlProfile[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  return <label className="field">
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {profiles.map((profile) => <option key={profile.id} value={profile.id}>
        {profile.label}{profile.mostRecent ? ' · последний вход' : ''}{profile.hasControls ? '' : ' · нет раскладки'}
      </option>)}
    </select>
  </label>;
}

function suggestedSource(profiles: readonly SteamControlProfile[]): SteamControlProfile | null {
  return profiles.find((profile) => profile.mostRecent && profile.hasControls)
    ?? profiles.find((profile) => profile.hasControls)
    ?? null;
}
