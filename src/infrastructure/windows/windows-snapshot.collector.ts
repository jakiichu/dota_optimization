import { fileURLToPath } from 'node:url';
import type { SnapshotCollector } from '../../application/ports/snapshot-collector.port.ts';
import type { SystemSnapshot } from '../../domain/snapshot/system-snapshot.ts';
import { runJsonScript } from './powershell.runner.ts';
import { toSystemSnapshot } from './snapshot.mapper.ts';

const SCRIPT_PATH = fileURLToPath(new URL('./collect-snapshot.ps1', import.meta.url));

/** Читает конфигурацию живой машины через PowerShell. */
export class WindowsSnapshotCollector implements SnapshotCollector {
  async collect(): Promise<SystemSnapshot> {
    return toSystemSnapshot(await runJsonScript(SCRIPT_PATH));
  }
}
