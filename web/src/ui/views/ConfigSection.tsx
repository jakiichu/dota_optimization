import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfigMutations, useGameConfig } from '../../application/queries.ts';
import type { ConfigChange, ConfigEdit, ConfigSetting, GameConfig } from '../../domain/models.ts';
import {
  IMPACT_COLOR,
  IMPACT_GROUP_HINT,
  IMPACT_GROUP_ORDER,
  IMPACT_GROUP_TITLE,
  NOTE_COLOR,
  type ImpactGroup,
} from '../../domain/presentation.ts';
import { SettingRow } from '../components/SettingRow.tsx';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/States.tsx';

/**
 * Редактор конфига игры.
 *
 * Правки копятся черновиком и уходят в файл одной кнопкой. Так сделано не ради
 * удобства: каждая запись создаёт резервную копию, и переключатель, пишущий на
 * диск при каждом щелчке, за минуту завалил бы папку игры копиями. Заодно
 * человек видит, что именно он собрался поменять, до того как это случилось.
 */

/** Что показать вместо значения, если правка — это удаление строки. */
const REMOVED = 'убрать';

const CONFIG_LOCATION = 'game\\dota\\cfg\\autoexec.cfg';

export function ConfigSection({
  proposed,
  onProposalTaken,
}: {
  /** Правки, ради которых сюда пришли из рекомендации. */
  proposed: readonly ConfigChange[];
  onProposalTaken: () => void;
}): React.JSX.Element {
  const config = useGameConfig();
  const { apply, replace, remove, exportToDesktop } = useConfigMutations();

  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Рекомендация привела сюда с готовым изменением — кладём его в черновик,
  // но не записываем: решение остаётся за человеком.
  useEffect(() => {
    if (proposed.length === 0) return;
    setDraft((previous) => ({
      ...previous,
      ...Object.fromEntries(proposed.map((change) => [change.cvar, change.value])),
    }));
    onProposalTaken();
  }, [proposed, onProposalTaken]);

  if (config.isPending) return <LoadingState what="Ищу конфиг игры…" />;
  if (config.isError) {
    return <ErrorState message={config.error.message} onRetry={() => void config.refetch()} />;
  }

  const data = config.data;
  const edits = toEdits(draft, data.settings);
  const proposedNames = new Set(proposed.map((change) => change.cvar));

  return (
    <>
      <SectionHeader
        title="Конфиг игры"
        subtitle={data.path ?? 'Игра не найдена — редактировать нечего.'}
        stale={config.isFetching}
      >
        <button
          type="button"
          className="button"
          disabled={!data.exists || exportToDesktop.isPending}
          onClick={() => exportToDesktop.mutate()}
        >
          Скачать на рабочий стол
        </button>
        {data.exists &&
          (confirmingRemove ? (
            <>
              <button
                type="button"
                className="button danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate();
                  setConfirmingRemove(false);
                  setDraft({});
                }}
              >
                Точно удалить
              </button>
              <button type="button" className="button" onClick={() => setConfirmingRemove(false)}>
                Отмена
              </button>
            </>
          ) : (
            <button type="button" className="button" onClick={() => setConfirmingRemove(true)}>
              Удалить конфиг
            </button>
          ))}
      </SectionHeader>

      <Outcomes
        exportedPath={exportToDesktop.data}
        exportError={exportToDesktop.error}
        backupPath={data.backupPath}
        writeError={apply.error ?? replace.error ?? remove.error}
      />

      {data.path === null ? (
        <EmptyState>
          Steam с установленной Dota найти не удалось. Конфиг лежит в{' '}
          <code>{CONFIG_LOCATION}</code> внутри папки игры.
        </EmptyState>
      ) : (
        <>
          {!data.exists && (
            <EmptyState>
              Конфига нет — и это нормально: <code>autoexec.cfg</code> создаёт сам игрок.
              Вставьте его ниже, и он появится там, где игра его ждёт.
            </EmptyState>
          )}

          {data.exists && (
            <>
              <Composition config={data} />
              <Notes config={data} />
              <DraftBar
                edits={edits}
                pending={apply.isPending}
                onDiscard={() => setDraft({})}
                onWrite={() => apply.mutate(edits, { onSuccess: () => setDraft({}) })}
              />
              <Groups
                config={data}
                draft={draft}
                proposedNames={proposedNames}
                onChange={(name, value) =>
                  setDraft((previous) => ({ ...previous, [name]: value }))
                }
              />
              <Unparsed config={data} />
            </>
          )}

          <QuickLoad
            exists={data.exists}
            pending={replace.isPending}
            onReplace={(text) => replace.mutate(text)}
          />
        </>
      )}
    </>
  );
}

/** Что случилось после нажатия: куда легла копия, где резерв, что сломалось. */
function Outcomes({
  exportedPath,
  exportError,
  backupPath,
  writeError,
}: {
  exportedPath: string | undefined;
  exportError: Error | null;
  backupPath: string | null;
  writeError: Error | null;
}): React.JSX.Element | null {
  if (writeError !== null) return <div className="notice error">{writeError.message}</div>;
  if (exportError !== null) return <div className="notice error">{exportError.message}</div>;

  return (
    <>
      {exportedPath !== undefined && (
        <div className="notice">
          Копия на рабочем столе: <code>{exportedPath}</code>
        </div>
      )}
      {/* Про резервную копию говорим сразу: человек должен знать, что откат
          возможен, до того как это ему понадобится. */}
      {backupPath !== null && (
        <div className="notice">
          Прежняя версия сохранена: <code>{backupPath}</code>
        </div>
      )}
    </>
  );
}

function Composition({ config }: { config: GameConfig }): React.JSX.Element {
  return (
    <div className="summary">
      <span className="chip" aria-pressed="true">
        {config.settingCount} настроек
      </span>
      {config.tally.map((entry) => (
        <span key={entry.impact} className="chip" aria-pressed="true">
          <span className="dot" style={{ background: IMPACT_COLOR[entry.impact] }} />
          {entry.label}: {entry.count}
        </span>
      ))}
    </div>
  );
}

function Notes({ config }: { config: GameConfig }): React.JSX.Element | null {
  if (config.notes.length === 0) return null;

  return (
    <>
      {config.notes.map((note) => (
        <div
          key={note.title}
          className="card"
          style={{ borderLeft: `3px solid ${NOTE_COLOR[note.severity]}` }}
        >
          <div className="card-head">
            <span className="card-title">{note.title}</span>
          </div>
          <div>{note.detail}</div>
          {note.remediation.length > 0 && (
            <ul className="steps">
              {note.remediation.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

function Unparsed({ config }: { config: GameConfig }): React.JSX.Element | null {
  if (config.unparsed.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Строки, которые не разобрались</span>
      </div>
      <ul className="steps">
        {config.unparsed.map((line) => (
          <li key={line}>
            <code>{line}</code>
          </li>
        ))}
      </ul>
      <div className="muted">Движок их, скорее всего, тоже пропустит. Мы их не трогаем.</div>
    </div>
  );
}

/** Панель черновика: что поменяется и когда это подействует. */
function DraftBar({
  edits,
  pending,
  onDiscard,
  onWrite,
}: {
  edits: readonly ConfigEdit[];
  pending: boolean;
  onDiscard: () => void;
  onWrite: () => void;
}): React.JSX.Element | null {
  if (edits.length === 0) return null;

  return (
    <div className="draft-bar">
      <div className="draft-list">
        {edits.map((edit) => (
          <span key={edit.name} className="draft-item">
            <code>{edit.name}</code> → <code>{edit.value ?? REMOVED}</code>
          </span>
        ))}
      </div>
      <div className="draft-actions">
        <button type="button" className="button" onClick={onDiscard} disabled={pending}>
          Отменить
        </button>
        <button type="button" className="button primary" onClick={onWrite} disabled={pending}>
          {pending ? 'Записываю…' : `Записать в файл (${edits.length})`}
        </button>
      </div>
      <div className="draft-note">
        Конфиг выполняется при запуске игры: если Dota открыта, изменения
        подхватятся со следующего запуска. Прежняя версия уедет в резервную копию.
      </div>
    </div>
  );
}

function Groups({
  config,
  draft,
  proposedNames,
  onChange,
}: {
  config: GameConfig;
  draft: Record<string, string | null>;
  proposedNames: ReadonlySet<string>;
  onChange: (name: string, value: string | null) => void;
}): React.JSX.Element {
  const grouped = useMemo(() => groupByImpact(config.settings), [config.settings]);

  return (
    <>
      {IMPACT_GROUP_ORDER.filter((group) => (grouped.get(group)?.length ?? 0) > 0).map((group) => (
        <div key={group} className="card">
          <div className="card-head">
            <span className="dot" style={{ background: IMPACT_COLOR[group] }} />
            <span className="card-title">{IMPACT_GROUP_TITLE[group]}</span>
            <span className="card-note">{grouped.get(group)?.length}</span>
          </div>
          <div className="group-hint">{IMPACT_GROUP_HINT[group]}</div>
          <div className="settings">
            {(grouped.get(group) ?? []).map((setting) => (
              <SettingRow
                key={`${setting.name}-${setting.line}`}
                setting={setting}
                value={draft[setting.name] ?? setting.value}
                changed={setting.name in draft}
                highlighted={proposedNames.has(setting.name)}
                onChange={(value) => onChange(setting.name, value)}
                onRemove={() => onChange(setting.name, null)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Быстрая загрузка конфига.
 *
 * Чтобы перенести конфиг между машинами, не нужно искать папку игры: текст
 * вставляется сюда, а файл ложится туда, куда игра смотрит. Прежний при этом
 * не пропадает — уезжает в резервную копию.
 */
function QuickLoad({
  exists,
  pending,
  onReplace,
}: {
  exists: boolean;
  pending: boolean;
  onReplace: (text: string) => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = (file: File | undefined): void => {
    if (file === undefined) return;
    void file.text().then(setText);
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{exists ? 'Заменить конфиг' : 'Создать конфиг'}</span>
      </div>
      <div className="muted">
        Вставьте текст, перетащите файл или выберите его — в папку игры лезть не нужно.
      </div>

      <textarea
        className="input config-text"
        data-dragging={dragging}
        value={text}
        placeholder={'// autoexec.cfg\nfps_max 59\ndota_ambient_creatures 0'}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          load(event.dataTransfer.files[0]);
        }}
      />

      <div className="config-actions">
        <input
          ref={fileInput}
          type="file"
          accept=".cfg,.txt"
          hidden
          onChange={(event) => load(event.target.files?.[0])}
        />
        <button type="button" className="button" onClick={() => fileInput.current?.click()}>
          Выбрать файл
        </button>
        <button
          type="button"
          className="button primary"
          disabled={text.trim() === '' || pending}
          onClick={() => onReplace(text)}
        >
          {pending ? 'Записываю…' : exists ? 'Заменить целиком' : 'Создать конфиг'}
        </button>
      </div>
    </div>
  );
}

/**
 * Черновик в список правок.
 *
 * Значения, совпавшие с тем, что уже в файле, отбрасываются: записывать файл
 * ради правки, которой нет, незачем — а резервная копия при этом появилась бы.
 */
function toEdits(
  draft: Record<string, string | null>,
  settings: readonly ConfigSetting[],
): readonly ConfigEdit[] {
  const current = new Map(settings.map((setting) => [setting.name, setting.value]));

  return Object.entries(draft)
    .filter(([name, value]) => value !== current.get(name))
    .map(([name, value]) => ({ name, value }));
}

function groupByImpact(
  settings: readonly ConfigSetting[],
): Map<ImpactGroup, readonly ConfigSetting[]> {
  const grouped = new Map<ImpactGroup, ConfigSetting[]>();
  for (const setting of settings) {
    grouped.set(setting.impact, [...(grouped.get(setting.impact) ?? []), setting]);
  }
  return grouped;
}
