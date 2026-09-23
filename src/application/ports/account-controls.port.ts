export type SettingsTransferMode = 'controls' | 'all';
export interface TransferSettingsFile {
  readonly path: string;
  readonly sizeBytes: number;
}
export interface SteamControlProfile {
  readonly settingsFiles?: readonly TransferSettingsFile[];
  /** Локальный Steam AccountID; наружу путь к userdata не отдаём. */
  readonly id: string;
  readonly label: string;
  readonly mostRecent: boolean;
  readonly hasControls: boolean;
  readonly sizeBytes: number | null;
  readonly modifiedAt: string | null;
}

export interface ControlTransferResult {
  readonly transferredFiles?: readonly string[];
  readonly source: SteamControlProfile;
  readonly target: SteamControlProfile;
  readonly backupPath: string | null;
  readonly transferredBytes: number;
}

export interface AccountControlsStore {
  list(): Promise<readonly SteamControlProfile[]>;
  transfer(sourceId: string, targetId: string, mode?: SettingsTransferMode): Promise<ControlTransferResult>;
}
