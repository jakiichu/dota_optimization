import { describe, expect, it } from 'vitest';
import { reviewForeignConfig, sameValue } from '../../src/domain/gameconfig/config-review.ts';
import { parseGameConfig } from '../../src/domain/gameconfig/game-config.ts';

function parse(lines: readonly string[]) {
  return parseGameConfig('', lines.join('\n'));
}

function verdicts(foreign: readonly string[], own: readonly string[] | null) {
  const review = reviewForeignConfig(parse(foreign), own === null ? null : parse(own));
  return review.lines.map((line) => [line.setting.name, line.verdict]);
}

describe('reviewForeignConfig', () => {
  it('различает «заменит», «добавит» и «уже так»', () => {
    expect(
      verdicts(['fps_max 240', 'r_ssao 0', 'dota_ambient_cloth 0'], ['fps_max 120', 'r_ssao 0']),
    ).toEqual([
      ['fps_max', 'changes'],
      ['r_ssao', 'already'],
      ['dota_ambient_cloth', 'adds'],
    ]);
  });

  it('помнит, что стоит у вас сейчас', () => {
    const review = reviewForeignConfig(parse(['fps_max 240']), parse(['fps_max 120']));

    expect(review.lines[0]?.ownValue).toBe('120');
  });

  it('перекрытая строка не делает ничего: движок выполнит последнюю', () => {
    // Классика гайдов: блок «для слабых ПК» вставлен поверх блока «для всех».
    expect(verdicts(['fps_max 0', 'r_ssao 0', 'fps_max 240'], null)).toEqual([
      ['fps_max', 'shadowed'],
      ['r_ssao', 'adds'],
      ['fps_max', 'adds'],
    ]);
  });

  it('без своего конфига всё, что не перекрыто, добавится', () => {
    expect(verdicts(['r_ssao 0'], null)).toEqual([['r_ssao', 'adds']]);
  });

  it('бинды — команды, а не настройки, и со своими не сравниваются', () => {
    const review = reviewForeignConfig(
      parse(['bind "F1" "say gg"', 'bind "F2" "say wp"']),
      parse(['bind "F1" "say gl"']),
    );

    // Два бинда — одно имя. Посчитай мы их настройкой, второй «перекрыл» бы первый.
    expect(review.lines.map((line) => line.verdict)).toEqual(['command', 'command']);
    expect(review.lines[0]?.ownValue).toBeNull();
  });

  it('считает, сколько строк что-то поменяют, а сколько — нет', () => {
    const review = reviewForeignConfig(
      parse(['fps_max 240', 'r_ssao 0', 'r_ssao 0', 'bind "F1" "say gg"']),
      parse(['fps_max 120']),
    );

    expect(review.effective).toBe(2);
    expect(review.idle).toBe(1);
  });
});

describe('sameValue', () => {
  it('кавычки, регистр и лишние пробелы значение не меняют', () => {
    expect(sameValue('"120"', '120')).toBe(true);
    expect(sameValue('0  255 255', '0 255 255')).toBe(true);
    expect(sameValue('"True"', 'true')).toBe(true);
  });

  it('числа сравниваются как числа', () => {
    expect(sameValue('1.0', '1')).toBe(true);
    expect(sameValue('120', '12')).toBe(false);
  });

  it('пустое значение не равно нулю', () => {
    expect(sameValue('""', '0')).toBe(false);
  });
});
