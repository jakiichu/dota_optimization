import { useEffect, useRef, useState } from 'react';
import {
  clampChannel,
  formatRgb,
  fromHex,
  luminance,
  parseRgb,
  toHex,
  type Rgb,
} from '../../domain/color.ts';

/**
 * Выбор цвета для настроек вида `dota_friendly_color 0 255 255`.
 *
 * Три вещи, которых обычно не хватает в таких подборщиках и которые здесь есть.
 *
 * Первое — видно строку, которая уйдёт в файл. Квадратик красивый, но в
 * autoexec.cfg попадут три числа, и человек должен их видеть: он же потом
 * будет искать эту строку глазами.
 *
 * Второе — образец показан на фоне карты, а не на белом. Цвет союзников
 * выбирают не ради красоты, а чтобы отличать их от врагов в замесе на тёмном
 * фоне; на белом поле это не проверить.
 *
 * Третье — готовые цвета сверху. Это те самые десять цветов, которыми Dota
 * подписывает игроков: попасть в них вручную ползунками нельзя, а хочется
 * почти всегда именно в них.
 */

const YARD_BACKGROUND = 'linear-gradient(135deg, #2b3524, #1b2418 60%, #23301f)';

/** Цвета игроков Dota: первые пять — свет, вторые пять — тьма. */
const PRESETS: readonly { readonly label: string; readonly color: Rgb }[] = [
  { label: 'голубой', color: { r: 51, g: 117, b: 255 } },
  { label: 'бирюзовый', color: { r: 102, g: 255, b: 191 } },
  { label: 'фиолетовый', color: { r: 191, g: 0, b: 191 } },
  { label: 'жёлтый', color: { r: 243, g: 240, b: 11 } },
  { label: 'оранжевый', color: { r: 255, g: 107, b: 0 } },
  { label: 'розовый', color: { r: 254, g: 134, b: 194 } },
  { label: 'серый', color: { r: 161, g: 180, b: 71 } },
  { label: 'светло-синий', color: { r: 101, g: 212, b: 219 } },
  { label: 'зелёный', color: { r: 0, g: 131, b: 33 } },
  { label: 'коричневый', color: { r: 161, g: 101, b: 79 } },
];

const CHANNELS: readonly { readonly key: keyof Rgb; readonly label: string }[] = [
  { key: 'r', label: 'К' },
  { key: 'g', label: 'З' },
  { key: 'b', label: 'С' },
];

export function ColorField({
  value,
  onChange,
  label,
}: {
  /** Значение как в конфиге: `0 255 255`. */
  value: string;
  onChange: (value: string) => void;
  label: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const color = parseRgb(value) ?? { r: 255, g: 255, b: 255 };
  const hex = toHex(color);
  const light = luminance(color) > 0.55;

  // Закрываем по клику мимо и по Escape: панель перекрывает соседние строки,
  // и оставлять её открытой, уйдя мышью, — верный способ потерять место.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (root.current?.contains(event.target) === false) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const set = (next: Rgb): void => onChange(formatRgb(next));

  return (
    <div className="color-field" ref={root}>
      <button
        type="button"
        className="color-swatch"
        style={{ background: hex, color: light ? '#14171d' : '#f2f4f8' }}
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
        onClick={() => setOpen((was) => !was)}
      >
        {value}
      </button>

      {open && (
        <div className="color-panel" role="dialog" aria-label={`Цвет: ${label}`}>
          <div className="color-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="color-preset"
                title={preset.label}
                aria-label={preset.label}
                aria-current={formatRgb(preset.color) === formatRgb(color)}
                style={{ background: toHex(preset.color) }}
                onClick={() => set(preset.color)}
              />
            ))}
          </div>

          <div className="color-sliders">
            {CHANNELS.map((channel) => (
              <label key={channel.key} className="color-slider">
                <span className="color-slider-label">{channel.label}</span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={color[channel.key]}
                  onChange={(event) =>
                    set({ ...color, [channel.key]: clampChannel(Number(event.target.value)) })
                  }
                />
                <span className="color-slider-value">{color[channel.key]}</span>
              </label>
            ))}
          </div>

          <div className="color-row">
            {/* Системный подборщик рядом с ползунками: попасть в оттенок мышью
                по кругу быстрее, чем тремя числами. */}
            <input
              type="color"
              className="color-native"
              value={hex}
              aria-label="Подобрать цвет"
              onChange={(event) => {
                const picked = fromHex(event.target.value);
                if (picked !== null) set(picked);
              }}
            />
            <input
              type="text"
              className="input color-hex"
              value={hex}
              aria-label="Цвет шестнадцатеричным кодом"
              onChange={(event) => {
                const typed = fromHex(event.target.value);
                if (typed !== null) set(typed);
              }}
            />
          </div>

          {/* Проверка на том фоне, где цвет и будет работать. */}
          <div className="color-preview" style={{ background: YARD_BACKGROUND }}>
            <span className="color-preview-dot" style={{ background: hex }} />
            <span className="color-preview-text" style={{ color: hex }}>
              так это будет выглядеть на карте
            </span>
          </div>

          <div className="color-value">
            в файл уйдёт <code>{value}</code>
          </div>
        </div>
      )}
    </div>
  );
}
