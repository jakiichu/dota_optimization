export interface GameControl {
  isRunning(): Promise<boolean>;
  open(): Promise<void>;
  close(): Promise<void>;
}
