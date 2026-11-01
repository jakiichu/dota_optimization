import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GameControl } from '../../application/ports/game-control.port.ts';
import { SteamGameLauncher } from './steam-game.launcher.ts';

const execute = promisify(execFile);

export class WindowsGameControl implements GameControl {
  private readonly launcher: SteamGameLauncher;

  constructor(launcher: SteamGameLauncher) {
    this.launcher = launcher;
  }

  async isRunning(): Promise<boolean> {
    const { stdout } = await execute(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq dota2.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 5000 },
    );
    return /^"dota2\.exe","\d+"/im.test(stdout);
  }

  open(): Promise<void> {
    return this.launcher.openGame();
  }

  async close(): Promise<void> {
    try {
      await execute(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference = 'Stop'; Get-Process -Name dota2 -ErrorAction SilentlyContinue | ForEach-Object { if (-not $_.CloseMainWindow()) { throw 'Dota did not accept the close request. Close it from the game menu.' } }",
        ],
        { windowsHide: true, timeout: 5000 },
      );
    } catch (error) {
      throw new Error('Не удалось закрыть Dota. Завершите игру через её меню.', { cause: error });
    }
  }
}
