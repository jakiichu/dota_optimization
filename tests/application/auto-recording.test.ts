import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutoRecordingGate, retainAutoHistory } from '../../desktop/auto-recording.ts';

describe('автозапись', () => {
  it('запускает один раз и ждёт перезапуска после ручной остановки или ошибки', () => {
    const gate = new AutoRecordingGate();
    expect(gate.consider(['12'], false, false)).toBe(false);
    expect(gate.consider(['12'], true, false)).toBe(true);
    expect(gate.consider(['12'], true, false)).toBe(false);
    gate.consider([], true, false);
    expect(gate.consider(['13'], true, false)).toBe(true);
  });
  it('не заменяет ручную запись и не запускается после её остановки в той же игре', () => {
    const gate = new AutoRecordingGate();
    expect(gate.consider(['12'], true, true)).toBe(false);
    expect(gate.consider(['12'], true, false)).toBe(false);
  });
  it('чистит только зарегистрированные автозаписи и сохраняет последнюю сверх лимита', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kadroskop-auto-'));
    try {
      const ledger = join(root, 'ledger');
      for (const id of ['a', 'b', 'manual'])
        await writeFile(join(root, `${id}.json`), '1234567890');
      await retainAutoHistory(root, ledger, 'a');
      expect(await retainAutoHistory(root, ledger, 'b', 20, 5)).toBe(true);
      await expect(readFile(join(root, 'a.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(root, 'b.json'), 'utf8')).toBe('1234567890');
      expect(await readFile(join(root, 'manual.json'), 'utf8')).toBe('1234567890');
      await expect(retainAutoHistory(root, ledger, '../escape')).rejects.toThrow('Неверное');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
