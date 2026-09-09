import type { ConfigSetting } from '../../domain/models.ts';
import { IMPACT_COLOR } from '../../domain/presentation.ts';
import { ColorField } from './ColorField.tsx';

/**
 * Одна строка конфига — с именем, значением и объяснением.
 *
 * Имя переменной оставлено на виду намеренно, хотя оно и нечеловеческое:
 * именно его человек увидит в файле, найдёт в чужом конфиге и вобьёт в
 * консоль. Спрятав его за красивым названием, мы бы разорвали связь между
 * экраном и файлом — и первый же вопрос «а где это в моём autoexec» остался
 * бы без ответа.
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

      <div className="setting-explain">
        {/* Что делает — первым: это единственное, что человеку по-настоящему нужно. */}
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
        {/* Показываем и слово, и число: в файле лежит число, и человек должен
            видеть, что именно там окажется. */}
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
