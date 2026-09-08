import { describe, expect, it } from 'vitest';
import { analyzeGameConfig } from '../../src/domain/gameconfig/config-analysis.ts';
import {
  findSetting,
  parseGameConfig,
} from '../../src/domain/gameconfig/game-config.ts';

const PATH = 'C:\\dota\\cfg\\autoexec.cfg';

function parse(lines: readonly string[]) {
  return parseGameConfig(PATH, lines.join('\n'));
}

function analyze(lines: readonly string[], measured = {}) {
  return analyzeGameConfig(parse(lines), {
    pacingTimeShare: null,
    bottleneck: null,
    ...measured,
  });
}

function noteTitles(lines: readonly string[], measured = {}): string[] {
  return analyze(lines, measured).notes.map((note) => note.title);
}

describe('parseGameConfig', () => {
  it('читает настройку с точкой с запятой и без', () => {
    const config = parse(['fps_max 0', 'dota_ambient_cloth 0;']);

    expect(config.settings).toHaveLength(2);
    expect(findSetting(config, 'dota_ambient_cloth')?.value).toBe('0');
  });

  it('сохраняет значение из нескольких слов', () => {
    // Цвета задаются тремя числами — простой split по пробелу их разрежет.
    const config = parse(['dota_friendly_color 0 255 255']);

    expect(findSetting(config, 'dota_friendly_color')?.value).toBe('0 255 255');
  });

  it('помнит номер строки: человеку нужно знать, где это у него', () => {
    const config = parse(['// подпись', '', 'r_ssao 0']);

    expect(findSetting(config, 'r_ssao')?.line).toBe(3);
  });

  it('пропускает комментарии и пустые строки', () => {
    expect(parse(['// всё выключить', '   ', 'r_ssao 0']).settings).toHaveLength(1);
  });

  it('отдаёт последнее значение, потому что движок выполняет строки по порядку', () => {
    const config = parse(['fps_max 0', 'fps_max 240']);

    expect(findSetting(config, 'fps_max')?.value).toBe('240');
  });

  it('складывает неразобранное отдельно, а не молча теряет', () => {
    const config = parse(['r_ssao 0', 'что-то непонятное']);

    expect(config.settings).toHaveLength(1);
    expect(config.unparsed).toHaveLength(1);
  });

  it('не выдумывает описание незнакомой настройке', () => {
    // Настройки движка появляются с каждым патчем; про новую мы честно ничего
    // не знаем, и придумывать описание нельзя — человек ему поверит.
    const config = parse(['r_some_new_convar 1']);

    expect(config.settings[0]?.impact).toBeNull();
    expect(config.settings[0]?.what).toBeNull();
  });
});

describe('analyzeGameConfig', () => {
  it('называет состав конфига по устройствам', () => {
    const analysis = analyze(['r_ssao 0', 'r_grass_quality 0', 'dota_ambient_cloth 0']);

    const gpu = analysis.tally.find((entry) => entry.impact === 'gpu');
    const cpu = analysis.tally.find((entry) => entry.impact === 'cpu');

    expect(gpu?.count).toBe(2);
    expect(cpu?.count).toBe(1);
  });

  it('предупреждает о снятом потолке кадров', () => {
    expect(noteTitles(['fps_max 0'])).toContain('Конфиг снимает потолок кадров');
  });

  it('повышает важность, если рваный ритм уже измерен', () => {
    // Именно связь с замером отличает совет от гадания.
    const withoutMeasurement = analyze(['fps_max 0']);
    const withMeasurement = analyze(['fps_max 0'], { pacingTimeShare: 0.2 });

    expect(withoutMeasurement.notes[0]?.severity).toBe('warning');
    expect(withMeasurement.notes[0]?.severity).toBe('critical');
    expect(withMeasurement.notes[0]?.detail).toContain('20%');
  });

  it('не трогает потолок, если он задан числом', () => {
    expect(noteTitles(['fps_max 59'])).not.toContain('Конфиг снимает потолок кадров');
  });

  it('замечает, что конфиг разгружает не то устройство', () => {
    const titles = noteTitles(
      ['r_ssao 0', 'r_grass_quality 0', 'r_depth_of_field 0', 'dota_ambient_cloth 0'],
      { bottleneck: 'cpu' },
    );

    expect(titles).toContain('Конфиг разгружает в основном видеокарту');
  });

  it('молчит про устройство, когда упор не в процессор', () => {
    const titles = noteTitles(['r_ssao 0', 'r_grass_quality 0'], { bottleneck: 'gpu' });

    expect(titles).not.toContain('Конфиг разгружает в основном видеокарту');
  });

  it('отделяет строки, которые меняют игру, а не скорость', () => {
    const analysis = analyze(['dota_enemy_color 255 0 255', 'con_enable 1']);
    const note = analysis.notes.find(
      (entry) => entry.title === 'В конфиге есть строки не про производительность',
    );

    expect(note?.detail).toContain('dota_enemy_color');
    expect(note?.detail).toContain('con_enable');
  });

  it('находит настройку, заданную дважды', () => {
    const analysis = analyze(['fps_max 0', 'r_ssao 0', 'fps_max 240']);
    const note = analysis.notes.find((entry) => entry.title.includes('несколько раз'));

    expect(note?.detail).toContain('Строки 1, 3');
    expect(note?.detail).toContain('fps_max 240');
  });

  it('перечисляет незнакомые настройки, а не прячет их', () => {
    const analysis = analyze(['r_some_new_convar 1', 'r_ssao 0']);

    expect(analysis.unknown).toHaveLength(1);
    expect(analysis.unknown[0]?.name).toBe('r_some_new_convar');
  });
});
