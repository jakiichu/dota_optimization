import type { ConfigSetting } from '../../domain/models.ts';
import { IMPACT_COLOR } from '../../domain/presentation.ts';
import { ColorField } from './ColorField.tsx';

/**
 * Одна строка конфига: имя, значение, объяснение.
 *
 * Строка отвечает на три вопроса подряд, и порядок здесь не случаен.
 *
 * «Что это вообще» — имя переменной. Оно нечеловеческое, но именно его вы
 * увидите в файле, найдёте в чужом конфиге и вобьёте в консоль. Спрятав его за
 * красивым названием, мы бы разорвали связь между экраном и файлом.
 *
 * «Где я это видел» — название из меню игры, если оно там есть. У большинства
 * строк autoexec его нет: ради них файл и заводят.
 *
 * «Что оно делает» — наше описание и кто выполняет эту работу.
 */
export function SettingRow({
  setting,
  value,
  changed,
  highlighted,
  onChange,
  onRemove,
}: {
  setting: ConfigSetting;
  /** Текущее значение с учётом несохранённой правки. */
  value: string;
  changed: boolean;
  /** Строка, ради которой сюда пришли из рекомендации. */
  highlighted: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className="setting" data-changed={changed} data-highlighted={highlighted}>
      <div className="setting-main">
        <div className="setting-name">
          <code>{setting.name}</code>
          {changed && <span className="setting-flag">изменено</span>}
        </div>
        <Control setting={setting} value={value} onChange={onChange} />
        <button
          type="button"
          className="setting-remove"
          title={`Убрать строку ${setting.name} из конфига`}
          aria-label={`Убрать ${setting.name}`}
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      {setting.inGame !== null && (
        <div className="setting-ingame">
          в меню игры — «{setting.inGame.label}»
          {setting.inGame.inverted && (
            // Без этой оговорки название вводило бы в заблуждение: галочка
            // в меню и единица в конфиге здесь означают противоположное.
            <span className="setting-inverted">
              значение обратное: <code>1</code> здесь — это галочка снята
            </span>
          )}
        </div>
      )}

      <div className="setting-explain">
        {setting.what !== null && <span className="setting-what">{setting.what}</span>}
        <span className="setting-impact" style={{ color: IMPACT_COLOR[setting.impact] }}>
          {setting.impactLabel}
        </span>
        {setting.cost !== null && <span className="setting-cost">цена: {setting.cost}</span>}
        <span className="setting-line">строка {setting.line}</span>
      </div>
    </div>
  );
}

function Control({
  setting,
  value,
  onChange,
}: {
  setting: ConfigSetting;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  if (setting.kind === 'color') {
    return <ColorField value={value} label={setting.name} onChange={onChange} />;
  }

  if (setting.kind === 'toggle') {
    const on = value === '1';
    return (
      <button
        type="button"
        className="toggle"
        role="switch"
        aria-checked={on}
        aria-label={setting.name}
        onClick={() => onChange(on ? '0' : '1')}
      >
        <span className="toggle-track" />
        {/* И слово, и число: в файл уйдёт число, и человек должен видеть, какое. */}
        <span className="toggle-text">
          {on ? 'включено' : 'выключено'} <code>{value}</code>
        </span>
      </button>
    );
  }

  return (
    <input
      className="input setting-input"
      type={setting.kind === 'number' ? 'number' : 'text'}
      value={value}
      aria-label={setting.name}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
