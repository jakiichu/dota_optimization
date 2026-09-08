/**
 * Снимок состояния системы — единственный вход для правил аудита.
 *
 * Структура намеренно плоская и сериализуемая: снимок можно сохранить в файл,
 * прислать другому человеку и прогнать правила на чужой машине.
 *
 * Соглашение о `null`: `null` означает «прочитать не удалось», а не «выключено».
 * Отсутствие значения в реестре — это тоже информация, и правило должно уметь
 * отличить её от явного нуля.
 */
export type Unreadable = null;
export type Maybe<T> = T | Unreadable;

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'unknown';

export interface GpuInfo {
  readonly name: string;
  readonly vendor: GpuVendor;
  readonly driverVersion: Maybe<string>;
  /** Дата драйвера в ISO — по ней судим о свежести, версии у вендоров несравнимы. */
  readonly driverDate: Maybe<string>;
  readonly pnpDeviceId: Maybe<string>;
}

export interface DisplayInfo {
  readonly adapterName: string;
  readonly horizontalResolution: Maybe<number>;
  readonly verticalResolution: Maybe<number>;
  readonly currentRefreshHz: Maybe<number>;
  readonly maxRefreshHz: Maybe<number>;
}

export interface PowerInfo {
  readonly activeSchemeGuid: Maybe<string>;
  readonly activeSchemeName: Maybe<string>;
  /** Минимальная доля активных ядер, % (CPMINCORES). 100 = парковка выключена. */
  readonly minProcessorCoresPercentAc: Maybe<number>;
  readonly isLaptop: Maybe<boolean>;
  readonly onBattery: Maybe<boolean>;
}

export interface GraphicsSettings {
  /** HwSchMode: 1 — выкл, 2 — вкл (аппаратное планирование GPU, HAGS). */
  readonly hwSchMode: Maybe<number>;
  /** HwSchState: фактическое состояние, которое доложил драйвер. */
  readonly hwSchState: Maybe<number>;
  /** Dwm\\OverlayTestMode: 5 — MPO принудительно отключён. */
  readonly overlayTestMode: Maybe<number>;
  /** GameConfigStore\\GameDVR_Enabled. */
  readonly gameDvrEnabled: Maybe<number>;
  /** Policies\\...\\GameDVR\\AllowGameDVR. */
  readonly allowGameDvr: Maybe<number>;
  readonly autoGameModeEnabled: Maybe<number>;
  /** Сырая строка DirectXUserGlobalSettings (VRR / swap effect upgrade). */
  readonly directXUserGlobalSettings: Maybe<string>;
}

export interface SecurityInfo {
  /** DeviceGuard: VBS включена. */
  readonly virtualizationBasedSecurityEnabled: Maybe<number>;
  /** HVCI (Memory Integrity) — заметно стоит производительности. */
  readonly hypervisorEnforcedCodeIntegrityEnabled: Maybe<number>;
}

export interface NetworkAdapterInfo {
  readonly name: string;
  readonly interfaceDescription: string;
  readonly status: string;
  readonly isWireless: boolean;
  readonly linkSpeedMbps: Maybe<number>;
  /** Разрешено ли Windows отключать адаптер для экономии энергии. */
  readonly allowComputerToTurnOffDevice: Maybe<boolean>;
}

/** Настройки совместимости, выставленные для конкретного .exe. */
export interface AppCompatEntry {
  readonly executablePath: string;
  /** Сырое содержимое AppCompatFlags\\Layers, например `~ DISABLEDXMAXIMIZEDWINDOWEDMODE`. */
  readonly layers: string;
}

export interface OsInfo {
  readonly caption: string;
  readonly version: string;
  readonly buildNumber: string;
  readonly locale: Maybe<string>;
}

export interface CpuInfo {
  readonly name: string;
  readonly physicalCores: Maybe<number>;
  readonly logicalCores: Maybe<number>;
}

export interface SystemSnapshot {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly machineName: string;
  readonly collectedAsAdmin: boolean;
  readonly os: OsInfo;
  readonly cpu: CpuInfo;
  readonly gpus: readonly GpuInfo[];
  readonly displays: readonly DisplayInfo[];
  readonly power: PowerInfo;
  readonly graphics: GraphicsSettings;
  readonly security: SecurityInfo;
  readonly networkAdapters: readonly NetworkAdapterInfo[];
  readonly appCompat: readonly AppCompatEntry[];
  /** Проблемы самого сбора: какие ключи не прочитались и почему. */
  readonly collectionErrors: readonly string[];
}

export function primaryGpu(snapshot: SystemSnapshot): GpuInfo | undefined {
  const discrete = snapshot.gpus.find(
    (gpu) => gpu.vendor === 'nvidia' || gpu.vendor === 'amd',
  );
  return discrete ?? snapshot.gpus[0];
}
