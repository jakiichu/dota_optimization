import { describe, expect, it } from 'vitest';
import {
  parsePresentMonCsv,
  PresentMonCsvError,
  splitCsvLine,
} from '../../src/infrastructure/presentmon/presentmon-csv.parser.ts';

const V2_HEADER =
  'Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,' +
  'AllowsTearing,PresentMode,CPUStartTime,FrameTime,CPUBusy,CPUWait,GPULatency,' +
  'GPUTime,GPUBusy,GPUWait,DisplayLatency,DisplayedTime';

function v2Row(frameTime: number, cpuBusy: string, gpuBusy: string): string {
  return (
    `dota2.exe,1234,0x00000255,DXGI,0,0,1,Hardware: Independent Flip,0.000,` +
    `${frameTime},${cpuBusy},1.0,2.0,8.0,${gpuBusy},0.5,12.3,16.6`
  );
}

const V1_HEADER =
  'Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,Dropped,' +
  'TimeInSeconds,msInPresentAPI,msBetweenPresents,AllowsTearing,PresentMode,' +
  'msUntilRenderComplete,msUntilDisplayed,msBetweenDisplayChange';

describe('splitCsvLine', () => {
  it('не рассыпает строку на запятой внутри кавычек', () => {
    expect(splitCsvLine('"Game, The.exe",1234,16.7')).toEqual([
      'Game, The.exe',
      '1234',
      '16.7',
    ]);
  });

  it('понимает удвоенную кавычку', () => {
    expect(splitCsvLine('"say ""hi""",1')).toEqual(['say "hi"', '1']);
  });
});

describe('parsePresentMonCsv', () => {
  it('читает метрики PresentMon 2.x', () => {
    const csv = [V2_HEADER, v2Row(16.6, '4.2', '15.9'), v2Row(16.7, '4.3', '16.0')].join('\n');

    const capture = parsePresentMonCsv(csv);

    expect(capture.applicationName).toBe('dota2.exe');
    expect(capture.processId).toBe(1234);
    expect(capture.frames).toHaveLength(2);
    expect(capture.frames[0]?.frameTimeMs).toBe(16.6);
    expect(capture.frames[0]?.cpuBusyMs).toBe(4.2);
    expect(capture.frames[0]?.gpuBusyMs).toBe(15.9);
    expect(capture.frames[0]?.displayLatencyMs).toBe(12.3);
    expect(capture.frames[0]?.presentMode).toBe('Hardware: Independent Flip');
  });

  it('читает метрики PresentMon 1.x, где разбивки кадра нет', () => {
    const csv = [
      V1_HEADER,
      'dota2.exe,1234,0x255,DXGI,0,0,0,1.5,0.4,16.6,1,Hardware: Legacy Flip,3.0,9.0,16.6',
    ].join('\n');

    const capture = parsePresentMonCsv(csv);

    expect(capture.frames[0]?.frameTimeMs).toBe(16.6);
    expect(capture.frames[0]?.displayLatencyMs).toBe(9);
    expect(capture.frames[0]?.dropped).toBe(false);
    // Именно null, а не ноль: в 1.x эти метрики не измеряются вовсе.
    expect(capture.frames[0]?.cpuBusyMs).toBeNull();
    expect(capture.frames[0]?.gpuBusyMs).toBeNull();
  });

  it('превращает NA в null, а не в ноль', () => {
    const csv = [V2_HEADER, v2Row(16.6, 'NA', 'NA')].join('\n');

    const capture = parsePresentMonCsv(csv);

    expect(capture.frames[0]?.cpuBusyMs).toBeNull();
    expect(capture.frames[0]?.gpuBusyMs).toBeNull();
    expect(capture.frames[0]?.frameTimeMs).toBe(16.6);
  });

  it('читает абсолютное время, когда PresentMon запущен с --qpc_time_ms', () => {
    // Колонка CPUStartTime содержит счётчик производительности в миллисекундах.
    const csv = [
      V2_HEADER,
      'dota2.exe,1,0x1,DXGI,0,0,1,Flip,5000000.0,16.6,4.2,1,2,8,15.9,0.5,12.3,16.6',
      'dota2.exe,1,0x1,DXGI,0,0,1,Flip,5000016.6,16.7,4.3,1,2,8,16.0,0.5,12.3,16.6',
    ].join('\n');

    const capture = parsePresentMonCsv(csv, { timeColumnIsQpcMs: true });

    expect(capture.frames[0]?.qpcMs).toBe(5_000_000);
    expect(capture.frames[1]?.qpcMs).toBe(5_000_016.6);
    // Ось графика при этом ведётся от первого кадра, а не от загрузки системы.
    expect(capture.frames[0]?.startSeconds).toBe(0);
    expect(capture.frames[1]?.startSeconds).toBeCloseTo(0.0166, 4);
  });

  it('не трогает колонку времени, пока формат не подтверждён флагом', () => {
    // Без --qpc_time_ms там бывают то секунды, то дата с наносекундами.
    const csv = [V2_HEADER, v2Row(16.6, '4', '15')].join('\n');

    expect(parsePresentMonCsv(csv).frames[0]?.qpcMs).toBeNull();
  });

  it('строит запасную ось из самих кадров, когда абсолютного времени нет', () => {
    // Колонка времени в разных версиях то секунды, то тики QPC, то дата;
    // время между презентами от формата не зависит.
    const csv = [V2_HEADER, v2Row(10, '5', '9'), v2Row(20, '5', '9'), v2Row(30, '5', '9')].join(
      '\n',
    );

    const capture = parsePresentMonCsv(csv);

    expect(capture.frames.map((frame) => frame.startSeconds)).toEqual([0, 0.01, 0.03]);
  });

  it('пропускает мусорные строки, а не ломается на них', () => {
    const csv = [V2_HEADER, v2Row(16.6, '4', '15'), '', 'обрывок строки', v2Row(16.7, '4', '15')]
      .join('\n');

    expect(parsePresentMonCsv(csv).frames).toHaveLength(2);
  });

  it('внятно жалуется, если колонки времени кадра нет вовсе', () => {
    expect(() => parsePresentMonCsv('Application,ProcessID\ndota2.exe,1')).toThrow(
      PresentMonCsvError,
    );
  });

  it('сохраняет список колонок — по нему видно, каких метрик не будет', () => {
    const capture = parsePresentMonCsv([V1_HEADER, ''].join('\n'));

    expect(capture.availableColumns).toContain('msBetweenPresents');
    expect(capture.availableColumns).not.toContain('GPUBusy');
  });
});
