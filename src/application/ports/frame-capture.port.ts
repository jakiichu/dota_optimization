import type { FrameCapture } from '../../domain/telemetry/frame-sample.ts';

export interface FrameCaptureRequest {
  /** Имя исполняемого файла игры, например `dota2.exe`. */
  readonly processName: string;
  readonly seconds: number;
}

/**
 * Источник записи кадров.
 *
 * За портом прячется то, что запись требует прав администратора и внешнего
 * инструмента. Сценарию важно только, что на выходе — кадры.
 */
export interface FrameCaptureSource {
  capture(request: FrameCaptureRequest): Promise<FrameCapture>;
}
