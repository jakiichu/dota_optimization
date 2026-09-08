import { readFile } from 'node:fs/promises';
import type { SnapshotCollector } from '../../application/ports/snapshot-collector.port.ts';
import type { SystemSnapshot } from '../../domain/snapshot/system-snapshot.ts';
import { toSystemSnapshot } from '../windows/snapshot.mapper.ts';

/**
 * Читает снимок из файла.
 *
 * Нужен, чтобы разбирать чужую машину: человек присылает JSON, правила
 * отрабатывают локально. Ради этого снимок и сделан сериализуемым.
 */
export class JsonFileSnapshotCollector implements SnapshotCollector {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async collect(): Promise<SystemSnapshot> {
    const raw = await readFile(this.#path, 'utf8');
    return toSystemSnapshot(JSON.parse(raw));
  }
}
