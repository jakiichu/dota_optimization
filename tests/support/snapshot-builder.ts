import type { SystemSnapshot } from '../../src/domain/snapshot/system-snapshot.ts';

const EMPTY: SystemSnapshot = {
  schemaVersion: 1,
  capturedAt: '2026-01-01T00:00:00Z',
  machineName: 'TEST',
  collectedAsAdmin: true,
  os: { caption: 'Windows 11 Pro', version: '10.0.26200', buildNumber: '26200', locale: null },
  cpu: { name: 'Test CPU', physicalCores: 8, logicalCores: 16 },
  gpus: [],
  displays: [],
  power: {
    activeSchemeGuid: null,
    activeSchemeName: null,
    minProcessorCoresPercentAc: null,
    isLaptop: null,
    onBattery: null,
  },
  graphics: {
    hwSchMode: null,
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
  collectionErrors: [],
};

/**
 * Снимок, в котором ничего не прочиталось. Тест дописывает только то, что
 * проверяет, — так видно, от каких именно полей зависит правило.
 */
export function snapshotWith(overrides: Partial<SystemSnapshot>): SystemSnapshot {
  return { ...EMPTY, ...overrides };
}
