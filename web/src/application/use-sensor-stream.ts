import { useEffect, useRef, useState } from 'react';
import type { SensorSample } from '../domain/models.ts';
import { useApi } from './api-context.ts';

/** Сколько замеров держим в графике: при 250 мс это две минуты истории. */
const HISTORY_LENGTH = 480;

export interface SensorHistory {
  readonly time: number[];
  readonly utilizationByAdapter: Map<string, number[]>;
}

export interface SensorStreamState {
  readonly latest: SensorSample | null;
  readonly history: SensorHistory;
  readonly error: string | null;
}

function emptyHistory(): SensorHistory {
  return { time: [], utilizationByAdapter: new Map() };
}

/**
 * Живой поток замеров.
 *
 * Не запрос и не кеш: данные текут сами, а хранить их между открытиями экрана
 * незачем — они устаревают за секунду. Подписка живёт ровно пока открыт
 * раздел, и вместе с ней живёт процесс сайдкара.
 *
 * История лежит в ref, а не в состоянии: перерисовка нужна на каждый замер, но
 * пересоздавать массивы в сотни точек четыре раза в секунду — нет.
 */
export function useSensorStream(): SensorStreamState {
  const api = useApi();
  const historyRef = useRef<SensorHistory>(emptyHistory());
  const [latest, setLatest] = useState<SensorSample | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = api.subscribeToSensors(
      (sample) => {
        appendSample(historyRef.current, sample);
        setError(null);
        setLatest(sample);
      },
      (message) => setError(message),
    );
    return unsubscribe;
  }, [api]);

  return { latest, history: historyRef.current, error };
}

function appendSample(history: SensorHistory, sample: SensorSample): void {
  history.time.push(sample.elapsedSeconds);
  if (history.time.length > HISTORY_LENGTH) history.time.shift();

  for (const gpu of sample.gpus) {
    let values = history.utilizationByAdapter.get(gpu.adapterName);
    if (values === undefined) {
      // Новый адаптер выравниваем нулями, иначе оси разъедутся по длине.
      values = new Array<number>(history.time.length - 1).fill(0);
      history.utilizationByAdapter.set(gpu.adapterName, values);
    }
    values.push(gpu.utilizationPercent ?? 0);
    if (values.length > HISTORY_LENGTH) values.shift();
  }
}

export const SENSOR_HISTORY_SECONDS = HISTORY_LENGTH / 4;
