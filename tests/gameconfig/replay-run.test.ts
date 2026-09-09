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
  it('выставляет остановку до загрузки повтора, а не после', () => {
    // playdemo загружает повтор не мгновенно, и команда следующей строкой ушла
    // бы в ещё не начавшееся воспроизведение. Порядок здесь — единственный,
    // который может сработать.
    const { configLines } = buildLaunchScript(run());
    const pauseAt = configLines.findIndex((line) => line.startsWith('demo_pauseatservertick'));
    const playAt = configLines.findIndex((line) => line.startsWith('playdemo'));

    expect(pauseAt).toBeGreaterThanOrEqual(0);
    expect(pauseAt).toBeLessThan(playAt);
  });

  it('не кладёт в cfg перемотку: она промахнётся мимо незагруженного повтора', () => {
    const { configLines } = buildLaunchScript(run());

    expect(configLines.some((line) => line.includes('demo_gototick'))).toBe(false);
  });

  it('передаёт повтор движку без расширения и по его пути', () => {
    const { configLines } = buildLaunchScript(run());

    expect(configLines).toContain('playdemo replays/8865634649');
  });

  it('без тика не просит игру нигде останавливаться', () => {
    const { configLines } = buildLaunchScript(run({ startTick: null }));

    expect(configLines.some((line) => line.includes('demo_pauseatservertick'))).toBe(false);
  });

  it('просит Steam открыть Dota с нашим файлом команд', () => {
    const { launchArgs } = buildLaunchScript(run());

    expect(launchArgs).toEqual(['-applaunch', '570', '+exec', 'frameloss-bench']);
  });

  it('говорит человеку, что делать, а не делает вид, что всё само', () => {
    // Перемотка внутри повтора — единственное место, где мы не можем ручаться
    // за движок, и молчать об этом нельзя.
    const { steps } = buildLaunchScript(run());

    expect(steps.join(' ')).toContain('demo_gototick 42000');
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
      { name: '8865634649.dem', sizeBytes: 279_373_310 },
      { name: '8951116903.dem.partial', sizeBytes: 56_945_154 },
      { name: 'placeholder.txt', sizeBytes: 0 },
      { name: 'tiny.dem', sizeBytes: 1024 },
    ]);

    expect(found.map((replay) => replay.name)).toEqual(['8865634649.dem']);
  });
});
