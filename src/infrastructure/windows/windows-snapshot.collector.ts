import type { SnapshotCollector } from '../../application/ports/snapshot-collector.port.ts';
import type { SystemSnapshot } from '../../domain/snapshot/system-snapshot.ts';
import { RESOURCES } from '../paths/resources.ts';
import { probeSteamLibraries } from '../steam/steam-library.probe.ts';
import { runJsonScript } from './powershell.runner.ts';
import { toSystemSnapshot } from './snapshot.mapper.ts';

const SCRIPT_PATH = RESOURCES.collectSnapshotScript();

/**
 * Собирает снимок живой машины из двух источников.
 *
 * Реестр, WMI и WinAPI отдаёт PowerShell. Библиотеку Steam разбираем уже здесь:
 * VDF удобнее и надёжнее парсить в коде приложения, где это покрыто тестами,
 * чем регулярками в скрипте.
 */
export class WindowsSnapshotCollector implements SnapshotCollector {
  async collect(): Promise<SystemSnapshot> {
    const systemFacts = toSystemSnapshot(await runJsonScript(SCRIPT_PATH));
    const steam = await probeSteamLibraries(systemFacts.steamPath);

    return {
      ...systemFacts,
      games: steam.games,
      collectionErrors: [...systemFacts.collectionErrors, ...steam.errors],
    };
  }
}
