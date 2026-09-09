import { describe, expect, it } from 'vitest';
import { toConfigView } from '../../src/adapters/http/config.view.ts';
import { analyzeGameConfig } from '../../src/domain/gameconfig/config-analysis.ts';
import { parseGameConfig } from '../../src/domain/gameconfig/game-config.ts';
import type { GameConfigState } from '../../src/application/use-cases/manage-game-config.ts';

function state(lines: readonly string[]): GameConfigState {
  const config = parseGameConfig('C:/dota/cfg/autoexec.cfg', lines.join('\n'));
  return {
    path: config.path,
    exists: true,
    text: lines.join('\n'),
    config,
    analysis: analyzeGameConfig(config, { pacingTimeShare: null, bottleneck: null }),
    backupPath: null,
  };
}

/** Названия из меню игры — так, как их отдаёт файл локализации. */
const MENU: ReadonlyMap<string, string> = new Map([
  ['dota_settings_ambientcreatures', 'Фауна'],
  ['dota_settings_waterquality', 'Высокое качество воды'],
]);

function settingNamed(lines: readonly string[], name: string) {
  return toConfigView(state(lines), MENU).settings.find((entry) => entry.name === name);
}

describe('toConfigView', () => {
  it('несёт имя, значение и объяснение — всё сразу', () => {
    // Список из семидесяти переменных без подписей это и есть тот файл из
    // интернета, от которого мы человека уводим.
    const found = settingNamed(['dota_ambient_creatures 0'], 'dota_ambient_creatures');

    expect(found?.name).toBe('dota_ambient_creatures');
    expect(found?.value).toBe('0');
    expect(found?.what).toBe('зверьки на карте');
    expect(found?.line).toBe(1);
  });

it('говорит, кто делает работу, а не что будет, если выключить', () => {
    // Второе зависит от машины и выясняется замером. Обещать кадры, глядя
    // только на имя переменной, значило бы делать то, за что мы ругаем чужие
    // конфиги; оговорка про замер стоит один раз над группой.
    const found = settingNamed(['dota_ambient_creatures 0'], 'dota_ambient_creatures');

    expect(found?.impactLabel).toBe('считает процессор');
    expect(found?.impact).toBe('cpu');
  });

  it('честно помечает незнакомую настройку', () => {
    const found = settingNamed(['r_unheard_of_thing 3'], 'r_unheard_of_thing');

    expect(found?.known).toBe(false);
    expect(found?.impact).toBe('unknown');
    expect(found?.what).toBeNull();
    expect(found?.impactLabel).toContain('не знаем');
  });

  it('подсказывает, чем править значение', () => {
    const view = toConfigView(
      state(['fps_max 0', 'dota_ambient_creatures 0', 'dota_friendly_color 0 255 255']),
      MENU,
    );
    const kinds = new Map(view.settings.map((entry) => [entry.name, entry.kind]));

    expect(kinds.get('fps_max')).toBe('number');
    expect(kinds.get('dota_ambient_creatures')).toBe('toggle');
    expect(kinds.get('dota_friendly_color')).toBe('color');
  });

  it('отдаёт состав по группам', () => {
    const view = toConfigView(
      state(['r_ssao 0', 'dota_ambient_creatures 0', 'dota_ambient_cloth 0']),
      MENU,
    );
    const counts = new Map(view.tally.map((entry) => [entry.impact, entry.count]));

    expect(counts.get('cpu')).toBe(2);
    expect(counts.get('gpu')).toBe(1);
  });

  it('подписывает строку её названием из меню игры', () => {
    // Человек ищет настройку там, где привык, — в меню. «dota_ambient_creatures»
    // ему ничего не говорит, «Фауна» говорит сразу.
    const found = settingNamed(['dota_ambient_creatures 0'], 'dota_ambient_creatures');

    expect(found?.inGame).toEqual({ label: 'Фауна', inverted: false });
  });

  it('предупреждает, когда значение обратно галочке в меню', () => {
    // dota_cheap_water 1 означает, что «Высокое качество воды» ВЫКЛЮЧЕНО.
    // Подписать строку названием, не сказав об этом, — хуже, чем не подписать.
    const found = settingNamed(['dota_cheap_water 1'], 'dota_cheap_water');

    expect(found?.inGame).toEqual({ label: 'Высокое качество воды', inverted: true });
  });

  it('молчит про настройки, которых в меню нет', () => {
    // Таких в autoexec большинство — ради них файл и заводят.
    const found = settingNamed(['r_dota_allow_wind_on_trees 0'], 'r_dota_allow_wind_on_trees');

    expect(found?.inGame).toBeNull();
  });

  it('молчит, когда названия из игры не прочитались', () => {
    const view = toConfigView(state(['dota_ambient_creatures 0']), new Map());

    expect(view.settings[0]?.inGame).toBeNull();
  });

  it('у отсутствующего конфига пустой состав, а не выдуманный', () => {
    const view = toConfigView(
      {
        path: 'C:/dota/cfg/autoexec.cfg',
        exists: false,
        text: '',
        config: null,
        analysis: null,
        backupPath: null,
      },
      MENU,
    );

    expect(view.exists).toBe(false);
    expect(view.settings).toHaveLength(0);
    expect(view.notes).toHaveLength(0);
  });
});
