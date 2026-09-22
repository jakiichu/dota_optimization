export interface SteamControlProfile {
  /** Локальный Steam AccountID; наружу путь к userdata не отдаём. */
  readonly id: string;
  readonly label: string;
  readonly mostRecent: boolean;
  readonly hasControls: boolean;
  readonly sizeBytes: number | null;
  readonly modifiedAt: string | null;
}

export interface ControlTransferResult {
  readonly source: SteamControlProfile;
  readonly target: SteamControlProfile;
  readonly backupPath: string | null;
  readonly transferredBytes: number;
}

export interface AccountControlsStore {
  list(): Promise<readonly SteamControlProfile[]>;
  transfer(sourceId: string, targetId: string): Promise<ControlTransferResult>;
}
