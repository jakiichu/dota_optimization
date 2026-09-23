/** Экранирование аргумента по правилам Windows CommandLineToArgvW / CRT. */
export function quoteWindowsArgument(value: string): string {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function elevatedCommand(executable: string, args: readonly string[]): string {
  const argumentLine = args.map(quoteWindowsArgument).join(' ');
  return (
    `$ErrorActionPreference = 'Stop'; try { ` +
    `$captureProcess = Start-Process -FilePath ${psLiteral(executable)} ` +
    `-ArgumentList ${psLiteral(argumentLine)} -Verb RunAs -WindowStyle Hidden -PassThru -Wait; ` +
    `exit $captureProcess.ExitCode ` +
    `} catch { if ($_.Exception.NativeErrorCode -eq 1223) { exit 1223 }; [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`
  );
}

export function presentMonFailure(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('Не удалось запустить PresentMon.');
  const failure = error as Error & { code?: string | number; killed?: boolean; stderr?: string };
  const details = failure.stderr?.trim().slice(0, 1500);
  let message: string;
  if (failure.code === 1223) message = 'Запись отменена: запрос прав администратора был отклонён.';
  else if (failure.killed)
    message =
      'PresentMon не завершился за отведённое время. Запись остановлена по тайм-ауту; повышенный процесс может ещё завершать работу.';
  else if (failure.code === 6 || failure.code === 'EACCES' || failure.code === 'EPERM')
    message =
      'PresentMon не получил права для записи кадров. Проверьте запрос администратора и разрешения запуска.';
  else if (failure.code === 'ENOENT')
    message =
      'PresentMon.exe или PowerShell не найден. Запускайте приложение из полной папки сборки.';
  else message = `PresentMon завершился с ошибкой (код ${failure.code ?? 'неизвестен'}).`;
  return new Error(message + (details ? `\n${details}` : ''), { cause: error });
}
