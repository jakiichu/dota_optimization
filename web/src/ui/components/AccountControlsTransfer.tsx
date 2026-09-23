import { useEffect, useState } from 'react';
import { useAccountControls } from '../../application/queries.ts';
import type { SettingsTransferMode, SteamControlProfile } from '../../domain/models.ts';

export function AccountControlsTransfer(): React.JSX.Element {
  const { profiles, transfer, backups, restore } = useAccountControls();
  const [restoreChoice, setRestoreChoice] = useState('');
  const selectedBackup = backups.data?.find(
    (item) => `${item.targetId}/${item.id}` === restoreChoice,
  );
  const busy = transfer.isPending || restore.isPending;
  const [sourceChoice, setSourceChoice] = useState('');
  const [targetChoice, setTargetChoice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState<SettingsTransferMode>('all');
  const available = profiles.data?.profiles ?? [];
  const sourceId = sourceChoice || suggestedSource(available)?.id || '';
  const targetId = targetChoice || available.find((profile) => profile.id !== sourceId)?.id || '';
  const source = available.find((profile) => profile.id === sourceId) ?? null;
  const target = available.find((profile) => profile.id === targetId) ?? null;

  useEffect(() => setConfirming(false), [sourceId, targetId, mode]);
  const files = (source?.settingsFiles ?? []).filter(
    (file) => mode === 'all' || file.path.toLowerCase() === 'remote/cfg/dotakeys_personal.lst',
  );
  const canTransfer =
    source !== null && files.length > 0 && target !== null && source.id !== target.id;

  return (
    <div className="card account-transfer">
      <div className="card-head">
        <span className="card-title">Перенос настроек между аккаунтами</span>
        <span className="card-note">звук, управление, видео и игровые предпочтения</span>
      </div>

      {profiles.isPending && <div className="muted">Ищу локальные аккаунты Steam…</div>}
      {profiles.isError && (
        <div className="notice error">
          {profiles.error.message}
          <button type="button" className="button" onClick={() => void profiles.refetch()}>
            Повторить
          </button>
        </div>
      )}
      {profiles.data !== undefined && available.length < 2 && (
        <div className="muted">
          Для переноса нужны хотя бы два локальных Steam-аккаунта, на которых запускали Dota.
        </div>
      )}

      {available.length >= 2 && (
        <>
          <label className="field">
            <span>Что перенести</span>
            <select
              value={mode}
              disabled={busy}
              onChange={(event) => {
                setMode(event.target.value as SettingsTransferMode);
                transfer.reset();
              }}
            >
              <option value="all">Все доступные настройки</option>
              <option value="controls">Только персональная раскладка клавиш</option>
            </select>
          </label>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="account-transfer-grid">
              <AccountSelect
                label="Откуда"
                value={sourceId}
                profiles={available}
                onChange={(value) => {
                  setSourceChoice(value);
                  transfer.reset();
                }}
              />
              <span className="account-transfer-arrow" aria-hidden="true">
                →
              </span>
              <AccountSelect
                label="Куда"
                value={targetId}
                profiles={available}
                onChange={(value) => {
                  setTargetChoice(value);
                  transfer.reset();
                }}
              />
            </div>
          </fieldset>
          {source !== null && files.length === 0 && (
            <div className="notice error">
              У аккаунта «{source.label}» нет файлов для выбранного режима переноса.
            </div>
          )}

          {!confirming ? (
            <button
              type="button"
              className="button"
              disabled={!canTransfer || busy || profiles.isFetching}
              onClick={() => {
                void profiles.refetch().then((result) => {
                  if (!result.isError) setConfirming(true);
                });
              }}
            >
              Проверить перенос
            </button>
          ) : (
            <div className="account-transfer-confirm">
              <strong>
                {source?.label} → {target?.label}
              </strong>
              <span>
                Будут перенесены файлы источника ({files.length}). Остальные файлы получателя
                сохранятся.
              </span>
              <details open>
                <summary>Состав переноса</summary>
                <ul>
                  {files.map((file) => (
                    <li key={file.path}>
                      <code>{file.path}</code> ·{' '}
                      {target?.settingsFiles?.some(
                        (candidate) => candidate.path.toLowerCase() === file.path.toLowerCase(),
                      )
                        ? 'замена с резервной копией'
                        : 'новый файл'}
                    </li>
                  ))}
                </ul>
              </details>
              <span>
                Перед заменой сохраняется резервная копия. При ошибке приложение попробует отменить
                изменения.
              </span>
              <span className="muted">
                Закройте Dota и полностью завершите Steam перед переносом. После запуска Steam
                проверьте настройки: облачная синхронизация может вернуть свою версию.
              </span>
              {mode === 'all' && (
                <span className="muted">
                  Переносятся доступные локальные настройки, включая звук, видео, сетки героев и
                  сборки. Инвентарь, рейтинг, история матчей, данные входа и параметры запуска Steam
                  не переносятся.
                </span>
              )}
              <div className="recommendation-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !canTransfer}
                  onClick={() =>
                    transfer.mutate(
                      { sourceId, targetId, mode },
                      { onSuccess: () => setConfirming(false) },
                    )
                  }
                >
                  {transfer.isPending ? 'Переношу…' : 'Перенести настройки'}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {transfer.isError && <div className="notice error">{transfer.error.message}</div>}
      {transfer.data !== undefined && (
        <div className="notice">
          Настройки перенесены: {transfer.data.source.label} → {transfer.data.target.label}.
          {transfer.data.backupPath !== null && (
            <>
              {' '}
              Резервная копия: <code>{transfer.data.backupPath}</code>.
            </>
          )}
        </div>
      )}
      <section aria-label="Резервные копии настроек">
        <div className="section-divider">
          <h2>Вернуть прежние настройки</h2>
          <button
            className="button"
            disabled={busy || backups.isFetching}
            onClick={() => void backups.refetch()}
          >
            Обновить список
          </button>
        </div>
        <p className="muted">
          Сохранённые состояния перед переносами и восстановлениями. Перед восстановлением закройте
          Dota и Steam. Текущее состояние будет сохранено в новой копии.
        </p>
        {backups.isPending && <p className="muted">Ищу резервные копии…</p>}
        {backups.isError && <div className="notice error">{backups.error.message}</div>}
        {backups.data?.length === 0 && (
          <p className="muted">
            Резервных копий пока нет. Они появятся после первого переноса. Неполные и повреждённые
            копии не предлагаются.
          </p>
        )}
        {(backups.data?.length ?? 0) > 0 && (
          <label className="field">
            <span>Сохранённое состояние</span>
            <select
              value={restoreChoice}
              disabled={busy}
              onChange={(event) => {
                setRestoreChoice(event.target.value);
                restore.reset();
              }}
            >
              <option value="">Выберите копию</option>
              {backups.data?.map((item) => (
                <option key={`${item.targetId}/${item.id}`} value={`${item.targetId}/${item.id}`}>
                  {new Date(item.createdAt).toLocaleString('ru-RU')} · {item.targetLabel} ·{' '}
                  {item.kind === 'restore'
                    ? 'перед восстановлением'
                    : item.sourceLabel
                      ? `до переноса из ${item.sourceLabel}`
                      : 'перед переносом (источник неизвестен)'}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedBackup && (
          <div className="account-transfer-confirm">
            <strong>
              Вернуть настройки аккаунта «{selectedBackup.targetLabel}» на{' '}
              {new Date(selectedBackup.createdAt).toLocaleString('ru-RU')}?
            </strong>
            <details>
              <summary>Изменяемые файлы: {selectedBackup.files.length}</summary>
              <ul>
                {selectedBackup.files.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code> ·{' '}
                    {file.existed
                      ? 'восстановить прежнюю версию'
                      : 'удалить — до переноса отсутствовал'}
                  </li>
                ))}
              </ul>
            </details>
            <span>
              Остальные файлы сохранятся. Вернуться к текущему состоянию можно будет через новую
              копию «перед восстановлением».
            </span>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                restore.mutate(
                  { targetId: selectedBackup.targetId, backupId: selectedBackup.id },
                  { onSuccess: () => setRestoreChoice('') },
                )
              }
            >
              {restore.isPending ? 'Восстанавливаю…' : 'Вернуть прежние настройки'}
            </button>
          </div>
        )}
        {restore.isError && <div className="notice error">{restore.error.message}</div>}
        {restore.data && (
          <div className="notice">
            Настройки восстановлены. Предыдущее состояние сохранено:{' '}
            <code>{restore.data.backupPath}</code>. После запуска проверьте настройки в Dota: Steam
            Cloud может предложить облачную версию.
          </div>
        )}
      </section>
    </div>
  );
}

function AccountSelect({
  label,
  value,
  profiles,
  onChange,
}: {
  label: string;
  value: string;
  profiles: readonly SteamControlProfile[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.label}
            {profile.mostRecent ? ' · последний вход' : ''}
            {profile.settingsFiles?.length ? '' : ' · нет настроек'}
          </option>
        ))}
      </select>
    </label>
  );
}

function suggestedSource(profiles: readonly SteamControlProfile[]): SteamControlProfile | null {
  return (
    profiles.find((profile) => profile.mostRecent && profile.settingsFiles?.length) ??
    profiles.find((profile) => profile.settingsFiles?.length) ??
    null
  );
}
