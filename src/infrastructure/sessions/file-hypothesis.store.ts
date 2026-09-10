import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  HypothesisStore,
  StoredHypothesis,
} from '../../application/ports/hypothesis-store.port.ts';
import type { Recommendation } from '../../domain/gameconfig/recommendations.ts';

/**
 * Гипотезы в одном файле рядом с записями.
 *
 * Файл, а не по файлу на гипотезу: их единицы, они крошечные, и читать их
 * всегда нужно списком. Лежат там же, где записи, — папку с замерами носят
 * целиком, и гипотеза без своих записей бессмысленна.
 */
export class FileHypothesisStore implements HypothesisStore {
  readonly #path: string;
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
    this.#path = join(root, 'hypotheses.json');
  }

  async save(
    recommendation: Recommendation,
    beforeSessionId: string,
  ): Promise<StoredHypothesis> {
    const created: StoredHypothesis = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      recommendation,
      beforeSessionId,
      afterSessionId: null,
    };

    await this.#write([created, ...(await this.list())]);
    return created;
  }

  async list(): Promise<readonly StoredHypothesis[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, 'utf8'));
      return Array.isArray(parsed) ? (parsed as StoredHypothesis[]) : [];
    } catch {
      // Файла нет или он испорчен — гипотез просто нет. Ронять из-за этого
      // всё приложение незачем: замеры от него не зависят.
      return [];
    }
  }

  async settle(id: string, afterSessionId: string): Promise<StoredHypothesis> {
    const all = await this.list();
    const found = all.find((entry) => entry.id === id);
    if (found === undefined) {
      throw new Error(`Гипотеза ${id} не найдена.`);
    }

    const settled: StoredHypothesis = { ...found, afterSessionId };
    await this.#write(all.map((entry) => (entry.id === id ? settled : entry)));
    return settled;
  }

  async forget(id: string): Promise<void> {
    const all = await this.list();
    await this.#write(all.filter((entry) => entry.id !== id));
  }

  async #write(all: readonly StoredHypothesis[]): Promise<void> {
    await mkdir(this.#root, { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  }
}
