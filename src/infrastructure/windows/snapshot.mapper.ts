import type {
  AppCompatEntry,
  CpuInfo,
  DisplayInfo,
  GpuInfo,
  GameProfile,
  GpuPreferenceEntry,
  GpuVendor,
  GraphicsSettings,
  Maybe,
  NetworkAdapterInfo,
  OsInfo,
  ReplayFile,
  PowerInfo,
  SecurityInfo,
  SystemSnapshot,
} from '../../domain/snapshot/system-snapshot.ts';

/**
 * Граница между «что вернул PowerShell» и «что обещает домен».
 *
 * Здесь и только здесь мы допускаем, что данные могут быть любой формы:
 * ConvertTo-Json в PowerShell 5.1 умеет свернуть массив из одного элемента в
 * объект, а отсутствующий ключ реестра приходит просто как null.
 */
export function toSystemSnapshot(raw: unknown): SystemSnapshot {
  const root = asRecord(raw);
  if (root === null) {
    throw new TypeError('Сборщик вернул не объект.');
  }

  return {
    schemaVersion: 1,
    capturedAt: asString(root['capturedAt']) ?? new Date().toISOString(),
    machineName: asString(root['machineName']) ?? 'unknown',
    collectedAsAdmin: root['collectedAsAdmin'] === true,
    os: toOs(root['os']),
    cpu: toCpu(root['cpu']),
    gpus: asArray(root['gpus']).map(toGpu),
    displays: asArray(root['displays']).map(toDisplay),
    power: toPower(root['power']),
    graphics: toGraphics(root['graphics']),
    security: toSecurity(root['security']),
    networkAdapters: asArray(root['networkAdapters']).map(toNetworkAdapter),
    appCompat: asArray(root['appCompat']).map(toAppCompat),
    gpuPreferences: asArray(root['gpuPreferences']).map(toGpuPreference),
    steamPath: asString(root['steamPath']),
    games: asArray(root['games']).map(toGame),
    collectionErrors: asArray(root['collectionErrors'])
      .map((entry) => asString(entry))
      .filter((entry): entry is string => entry !== null),
  };
}

// --- разбор отдельных секций ------------------------------------------------

function toOs(raw: unknown): OsInfo {
  const record = asRecord(raw) ?? {};
  return {
    caption: asString(record['caption']) ?? 'unknown',
    version: asString(record['version']) ?? 'unknown',
    buildNumber: asString(record['buildNumber']) ?? 'unknown',
    locale: asString(record['locale']),
  };
}

function toCpu(raw: unknown): CpuInfo {
  const record = asRecord(raw) ?? {};
  return {
    name: asString(record['name']) ?? 'unknown',
    physicalCores: asNumber(record['physicalCores']),
    logicalCores: asNumber(record['logicalCores']),
  };
}

const VENDORS: readonly GpuVendor[] = ['nvidia', 'amd', 'intel', 'unknown'];

function toGpu(raw: unknown): GpuInfo {
  const record = asRecord(raw) ?? {};
  const vendor = asString(record['vendor']);
  return {
    name: asString(record['name']) ?? 'unknown',
    vendor: VENDORS.find((known) => known === vendor) ?? 'unknown',
    driverVersion: asString(record['driverVersion']),
    driverDate: asString(record['driverDate']),
    pnpDeviceId: asString(record['pnpDeviceId']),
  };
}

function toDisplay(raw: unknown): DisplayInfo {
  const record = asRecord(raw) ?? {};
  return {
    adapterName: asString(record['adapterName']) ?? 'unknown',
    horizontalResolution: asNumber(record['horizontalResolution']),
    verticalResolution: asNumber(record['verticalResolution']),
    currentRefreshHz: asNumber(record['currentRefreshHz']),
    maxRefreshHz: asNumber(record['maxRefreshHz']),
  };
}

function toPower(raw: unknown): PowerInfo {
  const record = asRecord(raw) ?? {};
  return {
    activeSchemeGuid: asString(record['activeSchemeGuid']),
    activeSchemeName: asString(record['activeSchemeName']),
    minProcessorCoresPercentAc: asNumber(record['minProcessorCoresPercentAc']),
    isLaptop: asBoolean(record['isLaptop']),
    onBattery: asBoolean(record['onBattery']),
  };
}

function toGraphics(raw: unknown): GraphicsSettings {
  const record = asRecord(raw) ?? {};
  return {
    hwSchMode: asNumber(record['hwSchMode']),
    hwSchState: asNumber(record['hwSchState']),
    overlayTestMode: asNumber(record['overlayTestMode']),
    gameDvrEnabled: asNumber(record['gameDvrEnabled']),
    allowGameDvr: asNumber(record['allowGameDvr']),
    autoGameModeEnabled: asNumber(record['autoGameModeEnabled']),
    directXUserGlobalSettings: asString(record['directXUserGlobalSettings']),
  };
}

function toSecurity(raw: unknown): SecurityInfo {
  const record = asRecord(raw) ?? {};
  return {
    virtualizationBasedSecurityEnabled: asNumber(
      record['virtualizationBasedSecurityEnabled'],
    ),
    hypervisorEnforcedCodeIntegrityEnabled: asNumber(
      record['hypervisorEnforcedCodeIntegrityEnabled'],
    ),
  };
}

function toNetworkAdapter(raw: unknown): NetworkAdapterInfo {
  const record = asRecord(raw) ?? {};
  return {
    name: asString(record['name']) ?? 'unknown',
    interfaceDescription: asString(record['interfaceDescription']) ?? 'unknown',
    status: asString(record['status']) ?? 'unknown',
    isWireless: record['isWireless'] === true,
    linkSpeedMbps: asNumber(record['linkSpeedMbps']),
    allowComputerToTurnOffDevice: asBoolean(record['allowComputerToTurnOffDevice']),
  };
}

function toAppCompat(raw: unknown): AppCompatEntry {
  const record = asRecord(raw) ?? {};
  return {
    executablePath: asString(record['executablePath']) ?? '',
    layers: asString(record['layers']) ?? '',
  };
}

function toReplay(raw: unknown): ReplayFile {
  const record = asRecord(raw) ?? {};
  return {
    name: asString(record['name']) ?? '',
    sizeBytes: asNumber(record['sizeBytes']) ?? 0,
  };
}

function toGpuPreference(raw: unknown): GpuPreferenceEntry {
  const record = asRecord(raw) ?? {};
  return {
    executablePath: asString(record['executablePath']) ?? '',
    preference: asString(record['preference']) ?? '',
  };
}

function toGame(raw: unknown): GameProfile {
  const record = asRecord(raw) ?? {};
  return {
    appId: asString(record['appId']) ?? '',
    name: asString(record['name']) ?? 'unknown',
    installDir: asString(record['installDir']),
    executablePath: asString(record['executablePath']),
    launchOptions: asString(record['launchOptions']),
    configPath: asString(record['configPath']),
    config: asString(record['config']),
    replays: asArray(record['replays']).map(toReplay),
  };
}

// --- примитивы --------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** PowerShell 5.1 умеет отдать массив из одного элемента как объект. */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function asString(value: unknown): Maybe<string> {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asNumber(value: unknown): Maybe<number> {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): Maybe<boolean> {
  return typeof value === 'boolean' ? value : null;
}
