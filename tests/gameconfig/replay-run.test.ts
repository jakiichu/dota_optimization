import { describe, expect, it } from 'vitest';
import {
  buildLaunchScript,
  manualSeekCommand,
  usableReplays,
  validateReplayRun,
  type ReplayRun,
} from '../../src/domain/gameconfig/replay-run.ts';

function run(overrides: Partial<ReplayRun> = {}): ReplayRun {
  return { replayFile: '8865634649.dem', startTick: 42000, label: '', ...overrides };
}

describe('validateReplayRun', () => {
  it('не пускает в имя повтора то, что движок примет за команду', () => {
    // Имя уходит в строку cfg, которую выполнит игра. Точка с запятой или
    // перевод строки превратили бы имя файла в дописанную консольную команду.
    expect(() => validateReplayRun(run({ replayFile: 'a; quit.dem' }))).toThrow();
    expect(() => validateReplayRun(run({ replayFile: 'a\nquit.dem' }))).toThrow();
    expect(() => validateReplayRun(run({ replayFile: '../../secret.dem' }))).toThrow();
  });

  it('требует именно файл повтора', () => {
    expect(() => validateReplayRun(run({ replayFile: '8865634649' }))).toThrow('.dem');
  });

  it('не принимает дробный и отрицательный тик', () => {
    expect(() => validateReplayRun(run({ startTick: 12.5 }))).toThrow();
    expect(() => validateReplayRun(run({ startTick: -1 }))).toThrow();
  });

  it('разрешает прогон без тика: это «с начала повтора»', () => {
    expect(() => validateReplayRun(run({ startTick: null }))).not.toThrow();
  });
});

describe('buildLaunchScript', () => {
  it('не кладёт в cfg ни перемотку, ни ожидание тика', () => {
    // Перемотка промахнётся мимо ещё не загруженного повтора, а ожидание не
    // перематывает вовсе: заказав тридцатую минуту, повтор полчаса шёл бы с
    // начала, чтобы там замереть. Проверено на живом запуске.
    const { configLines } = buildLaunchScript(run());

    expect(configLines.some((line) => line.includes('demo_gototick'))).toBe(false);
    expect(configLines.some((line) => line.includes('demo_pauseatservertick'))).toBe(false);
  });

  it('включает быстрый пропуск кадров заранее', () => {
    // Единственное, что про перемотку можно выставить до загрузки повтора.
    const { configLines } = buildLaunchScript(run());

    expect(configLines).toContain('demo_usefastgoto 1');
  });

  it('передаёт повтор движку без расширения и по его пути', () => {
    const { configLines } = buildLaunchScript(run());

    expect(configLines).toContain('playdemo replays/8865634649');
  });

  it('открывает консоль: перемотку всё равно вводить руками', () => {
    const { launchArgs } = buildLaunchScript(run());

    expect(launchArgs).toEqual([
      '-applaunch',
      '570',
      '-console',
      '+exec',
      'frameloss-bench',
    ]);
  });

  it('говорит человеку, что делать, а не делает вид, что всё само', () => {
    // Перемотка — единственная часть прогона, которую нельзя автоматизировать:
    // начальный тик воспроизведения движку не задаётся.
    const { steps } = buildLaunchScript(run());

    expect(steps.join(' ')).toContain('demo_gototick 42000');
  });

  it('называет кнопку записи и тогда, когда тик не задан', () => {
    // Запуск игры и запись — два разных действия, и между ними игра занимает
    // весь экран. Раньше без тика шаг звучал как «запись можно запускать
    // сразу»: из этого не следует, что где-то есть вторая кнопка и нажать её
    // надо самому. Человек уходил в Dota и возвращался ни с чем.
    const withTick = buildLaunchScript(run()).steps.join(' ');
    const fromStart = buildLaunchScript(run({ startTick: null })).steps.join(' ');

    expect(withTick).toContain('Записать прогон');
    expect(fromStart).toContain('Записать прогон');
  });

  it('предупреждает, что во время записи надо быть в игре', () => {
    // Свёрнутая Dota рисует иначе, а переключение туда-сюда само даёт всплески,
    // которые запись зачтёт в статтеры.
    expect(buildLaunchScript(run()).steps.join(' ')).toContain('вернуться в игру');
  });

  it('отказывается собирать команды для негодного имени', () => {
    expect(() => buildLaunchScript(run({ replayFile: 'a";quit.dem' }))).toThrow();
  });
});

describe('manualSeekCommand', () => {
  it('молчит, когда перематывать некуда', () => {
    expect(manualSeekCommand(run({ startTick: null }))).toBeNull();
  });
});

describe('usableReplays', () => {
  it('отбрасывает обрезки и заготовки', () => {
    const found = usableReplays([
      { name: '8865634649.dem', sizeBytes: 279_373_310, ticks: 176_355, durationSeconds: 5879 },
      { name: '8951116903.dem.partial', sizeBytes: 56_945_154, ticks: null, durationSeconds: null },
      { name: 'placeholder.txt', sizeBytes: 0, ticks: null, durationSeconds: null },
      { name: 'tiny.dem', sizeBytes: 1024, ticks: null, durationSeconds: null },
    ]);

    expect(found.map((replay) => replay.name)).toEqual(['8865634649.dem']);
  });
});
