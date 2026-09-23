export interface RecordingState {
  startedAt?: string | null;
  phase: 'idle' | 'recording' | 'stopping' | 'saving' | 'completed' | 'failed';
  sessionId?: string | null;
  error?: string | null;
}

export function isRecording(state: RecordingState): boolean {
  return state.phase === 'recording' || state.phase === 'stopping' || state.phase === 'saving';
}

/** Не завершаем сервер до сохранения кадров, включая уже запрошенную остановку. */
export async function finishRecording(
  read: () => Promise<RecordingState>,
  stop: () => Promise<unknown>,
  pause: () => Promise<void>,
  attempts = 90,
): Promise<void> {
  let state = await read();
  if (state.phase === 'recording') await stop();
  for (let i = 0; i < attempts; i += 1) {
    state = await read();
    if (state.phase === 'failed') throw new Error(state.error ?? 'Не удалось сохранить запись.');
    if (!isRecording(state)) return;
    await pause();
  }
  throw new Error(
    'Сохранение ещё не завершено. Приложение остаётся открытым — попробуйте выйти позже.',
  );
}
