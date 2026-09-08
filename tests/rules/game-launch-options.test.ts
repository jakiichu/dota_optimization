import { describe, expect, it } from 'vitest';
import { gameLaunchOptionsRule } from '../../src/domain/rules/game-launch-options.rule.ts';
import { snapshotWith } from '../support/snapshot-builder.ts';

function withOptions(launchOptions: string | null) {
  return snapshotWith({
    games: [
      {
        appId: '570',
        name: 'Dota 2',
        installDir: 'dota 2 beta',
        executablePath: 'C:\\dota2.exe',
        launchOptions,
      },
    ],
  });
}

describe('gameLaunchOptionsRule', () => {
  it('пропускает безобидные параметры', () => {
    expect(gameLaunchOptionsRule.evaluate(withOptions('-novid -console'))?.severity).toBe('ok');
  });

  it('отмечает ручную раскладку по потокам', () => {
    const finding = gameLaunchOptionsRule.evaluate(withOptions('-novid -threads 8'));

    expect(finding?.severity).toBe('info');
    expect(finding?.observed).toContain('-threads');
  });

  it('отмечает снятый потолок кадров', () => {
    const finding = gameLaunchOptionsRule.evaluate(withOptions('+fps_max 0'));

    expect(finding?.observed).toContain('+fps_max 0');
  });

  it('не срабатывает на fps_max с обычным значением', () => {
    expect(gameLaunchOptionsRule.evaluate(withOptions('+fps_max 240'))?.severity).toBe('ok');
  });

  it('не путает -high с похожим по началу параметром', () => {
    expect(gameLaunchOptionsRule.evaluate(withOptions('-highdpi'))?.severity).toBe('ok');
  });

  it('молчит, когда игр не найдено', () => {
    expect(gameLaunchOptionsRule.evaluate(snapshotWith({}))).toBeNull();
  });
});
