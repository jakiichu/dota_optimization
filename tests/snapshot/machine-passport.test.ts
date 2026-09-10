import { describe, expect, it } from 'vitest';
import {
  diffPassports,
  passportFrom,
  type MachinePassport,
} from '../../src/domain/snapshot/machine-passport.ts';
import type { SystemSnapshot } from '../../src/domain/snapshot/system-snapshot.ts';

interface Options {
  readonly config?: string;
  readonly refreshHz?: number | null;
  readonly powerScheme?: string | null;
  readonly hags?: number | null;
}

function snapshot(options: Options = {}): SystemSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: '2026-09-10T00:00:00Z',
    machineName: 'PC',
    collectedAsAdmin: false,
    os: { caption: 'Windows 11', version: '10.0', buildNumber: '26200', locale: 'ru' },
    cpu: { name: 'Ryzen', physicalCores: 8, logicalCores: 16 },
    gpus: [
      {
        name: 'Radeon',
        vendor: 'amd',
        driverVersion: '31.0.21924.4004',
        driverDate: null,
        pnpDeviceId: null,
      },
    ],
    displays: [
      {
        adapterName: 'Radeon',
        horizontalResolution: 1920,
        verticalResolution: 1080,
        currentRefreshHz: options.refreshHz === undefined ? 60 : options.refreshHz,
        maxRefreshHz: 60,
      },
    ],
    power: {
      activeSchemeGuid: null,
      activeSchemeName: options.powerScheme === undefined ? 'Сбалансированная' : options.powerScheme,
      minProcessorCoresPercentAc: null,
      isLaptop: true,
      onBattery: false,
    },
    graphics: {
      hwSchMode: options.hags === undefined ? 2 : options.hags,
      hwSchState: null,
      overlayTestMode: null,
      gameDvrEnabled: null,
      allowGameDvr: null,
      autoGameModeEnabled: null,
      directXUserGlobalSettings: null,
    },
    security: {
      virtualizationBasedSecurityEnabled: null,
      hypervisorEnforcedCodeIntegrityEnabled: null,
    },
    networkAdapters: [],
    appCompat: [],
    gpuPreferences: [],
    steamPath: 'c:/steam',
    games:
      options.config === undefined
        ? []
        : [
            {
              appId: '570',
              name: 'Dota 2',
              installDir: 'dota 2 beta',
              executablePath: null,
              launchOptions: '-novid',
              configPath: 'c:/dota/cfg/autoexec.cfg',
              config: options.config,
              replays: [],
            },
          ],
    collectionErrors: [],
  };
}

function valueOf(passport: MachinePassport, key: string): string | undefined {
  return passport.settings.find((setting) => setting.key === key)?.value;
}

describe('passportFrom', () => {
  it('запоминает настройки игры', () => {
    const found = passportFrom(snapshot({ config: 'fps_max 59\nr_ssao 0' }));

    expect(valueOf(found, 'cvar:fps_max')).toBe('59');
    expect(valueOf(found, 'cvar:r_ssao')).toBe('0');
  });

  it('берёт последнее из повторов: движок выполняет файл сверху вниз', () => {
    const found = passportFrom(snapshot({ config: 'fps_max 0\nfps_max 59' }));

    expect(valueOf(found, 'cvar:fps_max')).toBe('59');
  });

  it('запоминает то, что человек меняет ради кадров, кроме конфига', () => {
    const found = passportFrom(snapshot());

    expect(valueOf(found, 'display.refreshHz')).toBe('60');
    expect(valueOf(found, 'power.scheme')).toBe('Сбалансированная');
    expect(valueOf(found, 'graphics.hags')).toBe('включено');
  });

  it('не записывает непрочитанное', () => {
    // «Не читали» и «выключено» — разные вещи. Записав первое как значение, мы
    // получили бы изменение настройки там, где просто починился сбор данных.
    const found = passportFrom(snapshot({ powerScheme: null, hags: null }));

    expect(valueOf(found, 'power.scheme')).toBeUndefined();
    expect(valueOf(found, 'graphics.hags')).toBeUndefined();
  });
});

describe('diffPassports', () => {
  it('находит изменённое значение', () => {
    const changes = diffPassports(
      passportFrom(snapshot({ config: 'fps_max 0' })),
      passportFrom(snapshot({ config: 'fps_max 59' })),
    );

    expect(changes).toEqual([
      { key: 'cvar:fps_max', label: 'fps_max', before: '0', after: '59' },
    ]);
  });

  it('считает изменением исчезнувшую строку', () => {
    // Убранная из конфига настройка меняет игру ровно так же, как исправленная.
    const changes = diffPassports(
      passportFrom(snapshot({ config: 'fps_max 59\nr_ssao 0' })),
      passportFrom(snapshot({ config: 'fps_max 59' })),
    );

    expect(changes).toEqual([
      { key: 'cvar:r_ssao', label: 'r_ssao', before: '0', after: null },
    ]);
  });

  it('считает изменением появившуюся строку', () => {
    const changes = diffPassports(
      passportFrom(snapshot({ config: 'fps_max 59' })),
      passportFrom(snapshot({ config: 'fps_max 59\nr_ssao 0' })),
    );

    expect(changes[0]?.before).toBeNull();
    expect(changes[0]?.after).toBe('0');
  });

  it('молчит, когда ничего не менялось', () => {
    const same = passportFrom(snapshot({ config: 'fps_max 59' }));

    expect(diffPassports(same, same)).toEqual([]);
  });

  it('видит изменения не только в игре', () => {
    const changes = diffPassports(
      passportFrom(snapshot({ refreshHz: 60 })),
      passportFrom(snapshot({ refreshHz: 144 })),
    );

    expect(changes.map((change) => change.key)).toContain('display.refreshHz');
  });
});
