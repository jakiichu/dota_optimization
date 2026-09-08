import { describe, expect, it } from 'vitest';
import { gameGpuPreferenceRule } from '../../src/domain/rules/game-gpu-preference.rule.ts';
import type { GpuInfo, SystemSnapshot } from '../../src/domain/snapshot/system-snapshot.ts';
import { snapshotWith } from '../support/snapshot-builder.ts';

const DOTA_EXE = 'C:\\Steam\\steamapps\\common\\dota 2 beta\\game\\bin\\win64\\dota2.exe';

function gpu(name: string, vendor: GpuInfo['vendor']): GpuInfo {
  return { name, vendor, driverVersion: null, driverDate: null, pnpDeviceId: null };
}

function laptopWith(preference: string | null): SystemSnapshot {
  return snapshotWith({
    gpus: [gpu('Intel UHD', 'intel'), gpu('GeForce RTX 4060', 'nvidia')],
    games: [
      {
        appId: '570',
        name: 'Dota 2',
        installDir: 'dota 2 beta',
        executablePath: DOTA_EXE,
        launchOptions: null,
      },
    ],
    gpuPreferences:
      preference === null ? [] : [{ executablePath: DOTA_EXE, preference }],
  });
}

describe('gameGpuPreferenceRule', () => {
  it('считает критичной привязку к энергосберегающему видеоядру', () => {
    const finding = gameGpuPreferenceRule.evaluate(laptopWith('GpuPreference=1;'));

    expect(finding?.severity).toBe('critical');
    expect(finding?.observed).toContain('Dota 2');
  });

  it('принимает явную привязку к дискретному GPU', () => {
    expect(gameGpuPreferenceRule.evaluate(laptopWith('GpuPreference=2;'))?.severity).toBe('ok');
  });

  it('сообщает, что выбор оставлен Windows', () => {
    expect(gameGpuPreferenceRule.evaluate(laptopWith(null))?.severity).toBe('info');
  });

  it('молчит на машине с одним видеоядром', () => {
    const desktop = snapshotWith({
      gpus: [gpu('AMD Radeon Graphics', 'amd')],
      games: [
        {
          appId: '570',
          name: 'Dota 2',
          installDir: 'dota 2 beta',
          executablePath: DOTA_EXE,
          launchOptions: null,
        },
      ],
    });

    expect(gameGpuPreferenceRule.evaluate(desktop)).toBeNull();
  });

  it('не различает регистр пути — Windows его тоже не различает', () => {
    const snapshot = snapshotWith({
      ...laptopWith('GpuPreference=1;'),
      gpuPreferences: [
        { executablePath: DOTA_EXE.toUpperCase(), preference: 'GpuPreference=1;' },
      ],
    });

    expect(gameGpuPreferenceRule.evaluate(snapshot)?.severity).toBe('critical');
  });
});
