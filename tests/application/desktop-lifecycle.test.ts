import { describe, expect, it, vi } from 'vitest';
import { finishRecording, isRecording, type RecordingState } from '../../desktop/lifecycle.ts';
import { startLocalServer } from '../../src/infrastructure/http/local-server.ts';

describe('выход настольного приложения', () => {
  it('останавливает запись и ждёт сохранения', async () => {
    const read = vi.fn<() => Promise<RecordingState>>()
      .mockResolvedValueOnce({ phase: 'recording' })
      .mockResolvedValueOnce({ phase: 'stopping' })
      .mockResolvedValueOnce({ phase: 'saving' })
      .mockResolvedValue({ phase: 'completed' });
    const stop = vi.fn(async () => undefined);
    const pause = vi.fn(async () => undefined);
    await finishRecording(read, stop, pause);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(2);
  });
  it('не повторяет остановку во время сохранения', async () => {
    const read = vi.fn<() => Promise<RecordingState>>()
      .mockResolvedValueOnce({ phase: 'saving' }).mockResolvedValue({ phase: 'completed' });
    const stop = vi.fn();
    await finishRecording(read, stop, async () => undefined);
    expect(stop).not.toHaveBeenCalled();
  });
  it('не разрешает завершение после отказа в правах', async () => {
    await expect(finishRecording(async () => ({ phase: 'recording' }),
      async () => { throw new Error('UAC отменён'); }, async () => undefined)).rejects.toThrow('UAC');
  });
  it('не теряет запись при долгом сохранении', async () => {
    await expect(finishRecording(async () => ({ phase: 'saving' }), async () => undefined,
      async () => undefined, 2)).rejects.toThrow('остаётся открытым');
  });
  it('показывает ошибку сохранения', async () => {
    await expect(finishRecording(async () => ({ phase: 'failed', error: 'Диск заполнен' }),
      async () => undefined, async () => undefined)).rejects.toThrow('Диск заполнен');
  });
  it('считает остановку и сохранение активной записью', () => {
    expect(isRecording({ phase: 'stopping' })).toBe(true);
    expect(isRecording({ phase: 'saving' })).toBe(true);
    expect(isRecording({ phase: 'completed' })).toBe(false);
  });
  it('выдаёт настоящий свободный порт и освобождает его при выходе', async () => {
    const server = await startLocalServer({ port: 0, staticRoot: null, streamRoutes: [],
      jsonRoutes: [{ path: '/status', handle: async () => ({ ready: true }) }] });
    try {
      expect(new URL(server.url).port).not.toBe('0');
      expect(await (await fetch(`${server.url}/status`)).json()).toEqual({ ready: true });
    } finally { await server.close(); }
    await expect(fetch(`${server.url}/status`)).rejects.toThrow();
  });
});
