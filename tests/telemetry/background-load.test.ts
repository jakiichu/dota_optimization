import { describe, expect, it } from 'vitest';
import {
  buildProcessTimeline,
  spikeNear,
  steadyLoad,
} from '../../src/domain/telemetry/background-load.ts';
import type { ProcessReading, SensorSample } from '../../src/domain/telemetry/sensor-sample.ts';

const QPC_FREQUENCY = 1000;

/** Замер на секунде `second`; `null` в процессах значит «не читали». */
function sample(second: number, processes: readonly ProcessReading[] | null): SensorSample {
  return {
    capturedAt: new Date(second * 1000).toISOString(),
    qpcTimestamp: second * QPC_FREQUENCY,
    qpcFrequency: QPC_FREQUENCY,
    gpus: [],
    cpu: null,
    network: [],
    processes,
    errors: [],
  };
}

function process(name: string, cpuPercent: number, processCount = 1): ProcessReading {
  return { name, cpuPercent, processCount };
}

describe('buildProcessTimeline', () => {
  it('молчит, когда процессы не читались ни разу', () => {
    // «Не собрали» и «никто не был занят» — разные вещи, и вторая не должна
    // выглядеть как первая.
    const timeline = buildProcessTimeline([sample(1, null), sample(2, null)], 'dota2.exe');

    expect(timeline).toBeNull();
  });

  it('отличает пустой замер от несделанного', () => {
    const timeline = buildProcessTimeline([sample(1, null), sample(2, [])], 'dota2.exe');

    expect(timeline?.points).toHaveLength(1);
  });

  it('не считает игру фоновой программой', () => {
    // Работа самой игры уже разобрана по кадру, и второй раз она не улика.
    const timeline = buildProcessTimeline(
      [sample(1, [process('dota2', 60), process('MsMpEng', 30)])],
      'dota2.exe',
    );

    expect([...(timeline?.usual.keys() ?? [])]).toEqual(['MsMpEng']);
  });
});

describe('spikeNear', () => {
  it('называет виновника по имени, с числами', () => {
    // Ради этого всё и делалось: «кадр ждал» говорит, что работу делал кто-то
    // другой, — здесь наконец видно кто.
    const timeline = buildProcessTimeline(
      [
        sample(1, [process('MsMpEng', 2)]),
        sample(2, [process('MsMpEng', 2)]),
        sample(3, [process('MsMpEng', 40)]),
        sample(4, [process('MsMpEng', 2)]),
      ],
      'dota2.exe',
    );

    const spike = spikeNear(timeline!, 2500);

    expect(spike?.name).toBe('MsMpEng');
    expect(spike?.cpuPercent).toBe(40);
    expect(spike?.usualPercent).toBe(2);
  });

  it('не называет виновником того, кто всегда так занят', () => {
    // Постоянная нагрузка одинакова в плохих кадрах и в хороших, а значит ни
    // одного из них не выделяет.
    const timeline = buildProcessTimeline(
      [
        sample(1, [process('VBCSCompiler', 20)]),
        sample(2, [process('VBCSCompiler', 21)]),
        sample(3, [process('VBCSCompiler', 22)]),
      ],
      'dota2.exe',
    );

    expect(spikeNear(timeline!, 2500)).toBeNull();
  });

  it('ловит рост у того, кто и так был занят', () => {
    // Программе, привычно занимающей четверть процессора, втрое вырасти
    // некуда — а прыжок на двадцать пунктов это три лишних занятых потока.
    const timeline = buildProcessTimeline(
      [
        sample(1, [process('OneDrive', 20)]),
        sample(2, [process('OneDrive', 20)]),
        sample(3, [process('OneDrive', 45)]),
      ],
      'dota2.exe',
    );

    expect(spikeNear(timeline!, 2500)?.cpuPercent).toBe(45);
  });

  it('не поднимает шум из-за десятикратного роста с нуля', () => {
    // Рост с 0.2% до 2% формально десятикратный и не значит ничего.
    const timeline = buildProcessTimeline(
      [sample(1, []), sample(2, []), sample(3, [process('Discord', 3)])],
      'dota2.exe',
    );

    expect(spikeNear(timeline!, 2500)).toBeNull();
  });

  it('берёт замер, чей интервал накрывает кадр, а не ближайший по времени', () => {
    // Замер, закончившийся за секунду до кадра, описывает совсем другую
    // секунду, — и «ближайший по расстоянию» выбрал бы именно его.
    const timeline = buildProcessTimeline(
      [
        sample(1, [process('Backup', 50)]),
        sample(2, []),
        sample(3, []),
        sample(4, [process('Backup', 50)]),
      ],
      'dota2.exe',
    );

    expect(spikeNear(timeline!, 1100)).toBeNull();
    expect(spikeNear(timeline!, 3100)?.name).toBe('Backup');
  });

  it('молчит про кадр позже последнего замера', () => {
    const timeline = buildProcessTimeline([sample(1, [process('Backup', 50)])], 'dota2.exe');

    expect(spikeNear(timeline!, 9000)).toBeNull();
  });

  it('из нескольких всплесков называет самый крупный', () => {
    const timeline = buildProcessTimeline(
      [
        sample(1, []),
        sample(2, []),
        sample(3, []),
        sample(4, [process('Backup', 20), process('MsMpEng', 35)]),
      ],
      'dota2.exe',
    );

    expect(spikeNear(timeline!, 3500)?.name).toBe('MsMpEng');
  });
});

describe('steadyLoad', () => {
  it('показывает, что крутилось всю запись', () => {
    const timeline = buildProcessTimeline(
      [
        sample(1, [process('VBCSCompiler', 6), process('Discord', 1)]),
        sample(2, [process('VBCSCompiler', 7), process('Discord', 1)]),
        sample(3, [process('VBCSCompiler', 9), process('Discord', 1)]),
      ],
      'dota2.exe',
    );

    const steady = steadyLoad(timeline!);

    expect(steady).toHaveLength(1);
    expect(steady[0]?.name).toBe('VBCSCompiler');
    expect(steady[0]?.usualPercent).toBe(7);
    expect(steady[0]?.peakPercent).toBe(9);
  });

  it('не показывает разовый всплеск как постоянную нагрузку', () => {
    // Это два разных вопроса: «кто мешал в ту секунду» и «что вообще
    // крутилось». Всплеск — улика, и в обстановке ему не место.
    const timeline = buildProcessTimeline(
      [sample(1, []), sample(2, []), sample(3, [process('MsMpEng', 40)])],
      'dota2.exe',
    );

    expect(steadyLoad(timeline!)).toEqual([]);
  });
});
