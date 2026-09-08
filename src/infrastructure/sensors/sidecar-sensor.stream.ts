import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type {
  SampleListener,
  SensorStream,
  Unsubscribe,
} from '../../application/ports/sensor-stream.port.ts';
import { toSensorSample } from './sidecar-sensor.sampler.ts';

const SIDECAR_PATH = fileURLToPath(
  new URL('../../../sidecar/bin/frameloss-sidecar.exe', import.meta.url),
);

const DEFAULT_INTERVAL_MS = 250;

/**
 * Поток замеров из долгоживущего процесса сайдкара.
 *
 * Процесс один на всех подписчиков и живёт ровно пока есть хотя бы один: так
 * счётчик загрузки GPU сохраняет предыдущее значение между замерами, а
 * пользователь не платит за фоновый процесс, когда никто не смотрит.
 */
export class SidecarSensorStream implements SensorStream {
  readonly #listeners = new Set<SampleListener>();
  readonly #intervalMs: number;
  #process: ChildProcessWithoutNullStreams | null = null;
  #reader: Interface | null = null;

  constructor(intervalMs: number = DEFAULT_INTERVAL_MS) {
    this.#intervalMs = intervalMs;
  }

  subscribe(listener: SampleListener): Unsubscribe {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      this.#start();
    }

    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#stop();
      }
    };
  }

  #start(): void {
    if (this.#process !== null) return;

    const child = spawn(
      SIDECAR_PATH,
      ['stream', '--interval-ms', String(this.#intervalMs)],
      { windowsHide: true },
    );
    this.#process = child;

    // Сайдкар пишет по одному JSON на строку, поэтому читаем построчно:
    // на границах chunk-ов stdout объект иначе рвётся пополам.
    this.#reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.#reader.on('line', (line) => this.#emit(line));

    child.on('error', () => this.#stop());
    child.on('exit', () => this.#stop());
  }

  #emit(line: string): void {
    if (line.trim() === '') return;

    let sample;
    try {
      sample = toSensorSample(JSON.parse(line));
    } catch {
      // Битая строка не повод ронять поток: следующая, скорее всего, целая.
      return;
    }

    for (const listener of this.#listeners) {
      listener(sample);
    }
  }

  #stop(): void {
    this.#reader?.close();
    this.#reader = null;

    const child = this.#process;
    this.#process = null;
    child?.kill();
  }
}

/** Проверка до подписки: иначе ошибка сборки всплывёт молчаливым пустым потоком. */
export async function ensureSidecarBuilt(): Promise<void> {
  try {
    await access(SIDECAR_PATH, constants.X_OK);
  } catch {
    throw new Error(
      `Сайдкар не найден: ${SIDECAR_PATH}\nСоберите его: npm run sidecar:build`,
    );
  }
}
