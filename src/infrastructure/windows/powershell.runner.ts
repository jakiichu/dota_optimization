import { runJsonProducingProcess } from '../process/json-process.runner.ts';

const POWERSHELL = 'powershell.exe';

/**
 * Запускает .ps1, который пишет JSON в файл, и возвращает разобранный результат.
 *
 * `-ExecutionPolicy Bypass` здесь не послабление безопасности, а способ работать
 * на машине с политикой по умолчанию: скрипт лежит рядом с приложением и не
 * приходит извне.
 */
export function runJsonScript(scriptPath: string, timeoutMs?: number): Promise<unknown> {
  return runJsonProducingProcess(
    POWERSHELL,
    (outputPath) => [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-OutputPath',
      outputPath,
    ],
    {
      label: scriptPath,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  );
}
