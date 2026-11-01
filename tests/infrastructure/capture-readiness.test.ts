import { describe, it, expect, vi } from 'vitest';
import {
  checkCaptureReadiness,
  sensorCheck,
} from '../../src/infrastructure/presentmon/capture-readiness.ts';
describe('проверка датчиков', () => {
  it('недоступные датчики дают предупреждение и освобождают подписку', async () => {
    const unsubscribe = vi.fn();
    const result = await sensorCheck({ subscribe: () => unsubscribe }, 1);
    expect(result.status).toBe('warning');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('ошибка запуска датчиков не запрещает запись кадров', async () => {
    const result = await sensorCheck(
      {
        subscribe: () => {
          throw new Error('missing');
        },
      },
      1,
    );
    expect(result.status).toBe('warning');
  });
});

it.skipIf(process.platform !== 'win32')(
  'проверяет установленный PresentMon, включая справку в stderr с кодом 1',
  async () => {
    const result = await checkCaptureReadiness('kadroskop-nonexistent-test.exe', {
      subscribe: () => () => {},
    });
    expect(result.checks.find((check) => check.id === 'presentmon')?.status).toBe('ok');
    expect(result.checks.find((check) => check.id === 'game')?.status).toBe('blocked');
  },
);
