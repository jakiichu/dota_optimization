import { describe, expect, it } from 'vitest';
import { withoutSetting, withSetting } from '../../src/domain/gameconfig/config-edit.ts';

describe('withSetting', () => {
  it('меняет значение, не трогая остальные строки', () => {
    const before = ['// мой конфиг', 'fps_max 0', 'r_ssao 0'].join('\n');

    expect(withSetting(before, 'fps_max', '59')).toBe(
      ['// мой конфиг', 'fps_max 59', 'r_ssao 0'].join('\n'),
    );
  });

  it('сохраняет комментарий в конце строки', () => {
    // Комментарий человек писал для себя — правка значения не повод его стирать.
    const before = 'fps_max 0 // снял потолок по совету с реддита';

    expect(withSetting(before, 'fps_max', '59')).toBe(
      'fps_max 59 // снял потолок по совету с реддита',
    );
  });

  it('сохраняет переводы строк файла', () => {
    // Конфиг живёт на Windows. Собрав его обратно с одними \n, мы получили бы
    // изменение во весь файл ради одной цифры.
    const before = 'fps_max 0\r\nr_ssao 0\r\n';

    expect(withSetting(before, 'fps_max', '59')).toBe('fps_max 59\r\nr_ssao 0\r\n');
  });

  it('правит последнюю из повторов: именно она и сработает', () => {
    const before = ['fps_max 0', 'r_ssao 0', 'fps_max 240'].join('\n');

    expect(withSetting(before, 'fps_max', '59')).toBe(
      ['fps_max 0', 'r_ssao 0', 'fps_max 59'].join('\n'),
    );
  });

  it('дописывает настройку, которой не было', () => {
    expect(withSetting('r_ssao 0\n', 'fps_max', '59')).toBe('r_ssao 0\nfps_max 59\n');
  });

  it('не плодит пустых строк в конце файла', () => {
    expect(withSetting('r_ssao 0\n\n\n', 'fps_max', '59')).toBe('r_ssao 0\nfps_max 59\n');
  });

  it('создаёт файл из ничего', () => {
    expect(withSetting('', 'fps_max', '59')).toBe('fps_max 59\n');
  });

  it('находит настройку без учёта регистра, но пишет как в файле', () => {
    expect(withSetting('FPS_MAX 0', 'fps_max', '59')).toBe('FPS_MAX 59');
  });
});

describe('withoutSetting', () => {
  it('убирает все вхождения', () => {
    const before = ['fps_max 0', 'r_ssao 0', 'fps_max 240'].join('\n');

    expect(withoutSetting(before, 'fps_max')).toBe('r_ssao 0');
  });

  it('оставляет файл как был, если убирать нечего', () => {
    const before = 'r_ssao 0\n';

    expect(withoutSetting(before, 'fps_max')).toBe(before);
  });
});
