import { toCaptureView } from '../../src/adapters/http/capture.view.ts';
import { analyzeCapture } from '../../src/domain/telemetry/capture-analysis.ts';
import { frameTrace } from './frame-builder.ts';
import type { Capture } from '../../web/src/domain/models.ts';

export function reportCapture(times = [...Array<number>(300).fill(10), 100, ...Array<number>(300).fill(10)]): Capture {
  const capture = { applicationName: 'private-application.exe', processId: 123,
    availableColumns: ['FrameTime'], frames: frameTrace(times) };
  return { sessionId: 'private-session-id',
    ...toCaptureView({ capture, ...analyzeCapture(capture, []), sensorSampleCount: 0 }) };
}
