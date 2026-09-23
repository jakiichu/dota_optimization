import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaptureRoutes } from '../../src/main/capture-route.ts';
import { PresentMonCapture } from '../../src/infrastructure/presentmon/presentmon.capture.ts';
import { UNKNOWN_MACHINE } from '../../src/domain/gameconfig/machine-context.ts';
import { EMPTY_PASSPORT } from '../../src/domain/snapshot/machine-passport.ts';
import type { FrameCapture } from '../../src/domain/telemetry/frame-sample.ts';
import type { SessionSummary } from '../../src/domain/telemetry/session-comparison.ts';
import { frameTrace } from '../support/frame-builder.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const frames: FrameCapture = {
  applicationName: 'dota2.exe',
  processId: 123,
  frames: frameTrace([16, 16, 16]),
  availableColumns: ['FrameTime'],
};

function setup() {
  const recording = deferred<FrameCapture>();
  vi.spyOn(PresentMonCapture.prototype, 'capture').mockReturnValue(recording.promise);
  const stop = vi.spyOn(PresentMonCapture.prototype, 'stop').mockResolvedValue();
  const save = vi.fn(async () => ({ id: 'saved-session' }) as SessionSummary);
  const unsubscribe = vi.fn();
  const routes = createCaptureRoutes(
    { subscribe: () => unsubscribe },
    {
      save,
      list: async () => [],
      load: async () => {
        throw new Error('unused');
      },
    },
    { get: async () => UNKNOWN_MACHINE, passport: async () => EMPTY_PASSPORT, forget() {} },
    { currentRun: async () => null },
  );
  const call = (path: string, query = '') => {
    const route = routes.find((item) => item.path === `/api/capture${path}`)!;
    return route.handle(new URLSearchParams(query), '');
  };
  return { recording, stop, save, unsubscribe, call };
}

afterEach(() => vi.restoreAllMocks());

describe('статус записи независимо от страницы', () => {
  it('фоновый запуск сразу отвечает и сохраняет результат без открытого HTTP-запроса', async () => {
    const { call, recording } = setup();
    const accepted = await call('', 'whole=1&background=1');
    expect(accepted).toMatchObject({ startedAt: expect.any(String) });
    await expect(call('', 'background=1')).rejects.toThrow('уже идёт');
    recording.resolve(frames);
    await vi.waitFor(async () =>
      expect(await call('/status')).toMatchObject({
        phase: 'completed',
        sessionId: 'saved-session',
      }),
    );
  });

  it('ошибка фоновой записи доступна через статус без необработанного исключения', async () => {
    const { call, recording } = setup();
    await call('', 'background=1');
    recording.reject(new Error('UAC отменён'));
    await vi.waitFor(async () =>
      expect(await call('/status')).toMatchObject({ phase: 'failed', error: 'UAC отменён' }),
    );
  });

  it('новый клиент видит идущую запись и результат после сохранения', async () => {
    const { call, recording, save, unsubscribe } = setup();
    expect(await call('/status')).toMatchObject({ phase: 'idle' });
    const running = call('', 'seconds=120&label=before');
    expect(await call('/status')).toMatchObject({
      phase: 'recording',
      seconds: 120,
      label: 'before',
      sessionId: null,
    });
    await expect(call('')).rejects.toThrow('уже идёт');
    recording.resolve(frames);
    await running;
    expect(await call('/status')).toMatchObject({
      phase: 'completed',
      sessionId: 'saved-session',
      error: null,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('остановка доступна другому клиенту и не отправляется повторно', async () => {
    const { call, recording, stop } = setup();
    const running = call('', 'whole=1');
    expect(await call('/status')).toMatchObject({ wholeGame: true });
    await call('/stop');
    await call('/stop');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await call('/status')).toMatchObject({ phase: 'stopping' });
    recording.resolve(frames);
    await running;
    expect(await call('/status')).toMatchObject({ phase: 'completed' });
  });

  it('после отказа в остановке разрешает попробовать снова', async () => {
    const { call, recording, stop } = setup();
    const running = call('');
    stop.mockRejectedValueOnce(new Error('UAC отменён'));
    await expect(call('/stop')).rejects.toThrow('UAC');
    expect(await call('/status')).toMatchObject({ phase: 'recording' });
    await call('/stop');
    recording.resolve(frames);
    await running;
  });

  it('сохраняет ошибку для страницы, открытой заново, и разрешает новый запуск', async () => {
    const { call, recording } = setup();
    const running = call('');
    recording.reject(new Error('PresentMon недоступен'));
    await expect(running).rejects.toThrow('PresentMon');
    expect(await call('/status')).toMatchObject({
      phase: 'failed',
      error: 'PresentMon недоступен',
    });
    vi.mocked(PresentMonCapture.prototype.capture).mockResolvedValue(frames);
    await call('');
    expect(await call('/status')).toMatchObject({ phase: 'completed', error: null });
  });

  it('не сообщает об успехе до сохранения и показывает ошибку диска', async () => {
    const { call, recording, save } = setup();
    const saving = deferred<SessionSummary>();
    save.mockReturnValue(saving.promise);
    const running = call('');
    recording.resolve(frames);
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(await call('/status')).toMatchObject({ phase: 'saving', sessionId: null });
    saving.reject(new Error('Нет места на диске'));
    await expect(running).rejects.toThrow('Нет места');
    expect(await call('/status')).toMatchObject({ phase: 'failed', sessionId: null });
  });

  it('поздняя ошибка остановки не перезаписывает завершённый результат', async () => {
    const { call, recording, stop } = setup();
    const stopping = deferred<void>();
    stop.mockReturnValue(stopping.promise);
    const running = call('');
    const request = call('/stop');
    recording.resolve(frames);
    await running;
    stopping.reject(new Error('Поздняя ошибка'));
    await expect(request).rejects.toThrow('Поздняя ошибка');
    expect(await call('/status')).toMatchObject({ phase: 'completed' });
  });
});
