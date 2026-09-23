import { AutoRecordingGate, dotaProcesses, retainAutoHistory } from './auto-recording.ts';
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  nativeImage,
  Notification,
  session,
  ipcMain,
} from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { finishRecording, isRecording, type RecordingState } from './lifecycle.ts';

app.setName('Кадроскоп');
app.setAppUserModelId('ru.kadroskop.desktop');
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let backend: ChildProcess | null = null;
let url = '';
let quitting = false;
let exitPending = false;
let starting = false;
let last: RecordingState = { phase: 'idle' };
let poll: ReturnType<typeof setTimeout> | undefined;
let logPath = '';
let healthy = false;

let autoCompletion: Promise<void> | null = null;
let autoEnabled = false;
let autoMessage = 'Автозапись выключена';
let autoPoll: ReturnType<typeof setTimeout> | undefined;
const autoGate = new AutoRecordingGate();
const sessionsDirectory = () =>
  app.isPackaged ? join(app.getPath('userData'), 'sessions') : resolve(__dirname, '../../sessions');
function setAuto(enabled: boolean): void {
  writeFileSync(join(app.getPath('userData'), 'auto-recording.json'), JSON.stringify({ enabled }));
  autoEnabled = enabled;
  autoMessage = enabled ? 'Ожидаю запуск Dota' : 'Автозапись выключена';
  updateTray();
}
async function autoTick(): Promise<void> {
  try {
    if (autoEnabled && !quitting && !exitPending && healthy) {
      const pids = await dotaProcesses();
      if (quitting || exitPending || !autoEnabled) return;
      const status = await readStatus();
      if (autoGate.consider(pids, autoEnabled, starting || isRecording(status))) {
        autoCompletion = startAutoRecording();
      } else if (!starting && !isRecording(status)) {
        autoMessage = pids.length
          ? 'Следующая автозапись — после перезапуска Dota'
          : 'Ожидаю запуск Dota';
      }
    }
  } catch (error) {
    autoMessage = 'Не удалось проверить Dota';
    log(String(error));
  } finally {
    if (!quitting)
      autoPoll = setTimeout(() => {
        void autoTick();
      }, 5000);
  }
}
async function startAutoRecording(): Promise<void> {
  starting = true;
  autoMessage = 'Автоматическая запись Dota';
  updateTray();
  try {
    notify(
      'Dota запущена',
      'Начинаю запись до выхода из игры (максимум 4 часа). Windows может запросить права администратора.',
    );
    const response = await fetch(
      `${url}/api/capture?background=1&whole=1&process=dota2.exe&label=${encodeURIComponent('Автозапись Dota')}`,
    );
    const accepted = (await response.json()) as { startedAt?: string; error?: string };
    if (!response.ok || !accepted.startedAt)
      throw new Error(accepted.error ?? 'Не удалось начать автозапись.');
    let result: RecordingState;
    do {
      await pause(1500);
      result = await readStatus();
      if (result.startedAt !== accepted.startedAt)
        throw new Error('Состояние записи изменилось. Проверьте историю.');
    } while (isRecording(result));
    if (result.phase !== 'completed' || !result.sessionId)
      throw new Error(result.error ?? 'Автозапись не сохранена.');
    try {
      const oversized = await retainAutoHistory(
        sessionsDirectory(),
        join(app.getPath('userData'), 'auto-history.json'),
        result.sessionId,
      );
      if (oversized)
        notify('Большая запись', 'Последняя автозапись превышает 2 ГБ и сохранена целиком.');
    } catch (error) {
      log(String(error));
      notify('История автозаписей', 'Запись сохранена, но очистить старые автозаписи не удалось.');
    }
    autoMessage = 'Запись сохранена. Ожидаю следующий запуск Dota';
  } catch (error) {
    autoMessage = 'Автозапись не удалась. Повтор — после перезапуска Dota';
    log(String(error));
    notify('Автозапись не завершена', String(error));
  } finally {
    starting = false;
    updateTray();
  }
}

const assets = join(__dirname, 'assets');
function log(message: string): void {
  if (logPath) appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}
function notify(title: string, body: string): void {
  if (Notification.isSupported())
    new Notification({ title, body, icon: join(assets, 'icon.png') }).show();
}
async function api<T>(path: string, post = false): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    signal: AbortSignal.timeout(post ? 60_000 : 10_000),
    ...(post
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      : {}),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Ошибка ${response.status}`);
  return data;
}
const readStatus = () => api<RecordingState>('/api/capture/status');

function showWindow(): void {
  if (window === null) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function updateTray(): void {
  if (tray === null) return;
  const active = starting || isRecording(last);
  const title = !healthy
    ? 'Подключение к сборщику…'
    : last.phase === 'saving'
      ? 'Сохраняю запись…'
      : last.phase === 'stopping'
        ? 'Останавливаю запись…'
        : last.phase === 'recording'
          ? 'Идёт запись'
          : starting
            ? 'Запускаю запись…'
            : 'Готов к записи';
  tray.setToolTip(`Кадроскоп — ${title}`);
  tray.setImage(join(assets, active ? 'recording.png' : 'icon.png'));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: title, enabled: false },
      { type: 'separator' },
      { label: 'Открыть Кадроскоп', click: showWindow },
      {
        label: 'Автозапись при запуске Dota',
        type: 'checkbox',
        checked: autoEnabled,
        enabled: !exitPending,
        click: (item) => {
          try {
            setAuto(item.checked);
          } catch (error) {
            showError(error);
          }
        },
      },
      { label: autoMessage, enabled: false },
      {
        label: 'Записать 60 секунд',
        enabled: healthy && !active && !exitPending,
        click: () => {
          void startRecording();
        },
      },
      {
        label: 'Остановить и сохранить',
        enabled: healthy && last.phase === 'recording' && !exitPending,
        click: () => {
          void api('/api/capture/stop', true).catch(showError);
        },
      },
      { type: 'separator' },
      {
        label: 'Выйти',
        enabled: !exitPending,
        click: () => {
          void requestExit();
        },
      },
    ]),
  );
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log(message);
  dialog.showErrorBox('Кадроскоп', message);
}

async function startRecording(): Promise<void> {
  if (starting || isRecording(last) || exitPending) return;
  starting = true;
  updateTray();
  try {
    notify('Запись через 5 секунд', 'Вернитесь в Dota 2. Будет записана одна минута игры.');
    await pause(5000);
    // Запись не привязана к времени жизни окна и не имеет короткого HTTP-таймаута.
    const response = await fetch(
      `${url}/api/capture?seconds=60&process=dota2.exe&label=${encodeURIComponent('Запись из трея')}`,
    );
    if (!response.ok) throw new Error(((await response.json()) as { error: string }).error);
    await response.arrayBuffer();
  } catch (error) {
    showError(error);
  } finally {
    starting = false;
    updateTray();
  }
}

async function pollStatus(): Promise<void> {
  try {
    const next = await readStatus();
    healthy = true;
    if (next.phase === 'completed' && next.sessionId !== last.sessionId) {
      notify('Запись сохранена', 'Откройте Кадроскоп из трея, чтобы посмотреть результат.');
    }
    if (next.phase === 'failed' && last.phase !== 'failed')
      notify('Запись не завершена', next.error ?? 'Откройте приложение для подробностей.');
    last = next;
  } catch {
    healthy = false;
  }
  updateTray();
  if (!quitting)
    poll = setTimeout(() => {
      void pollStatus();
    }, 1500);
}

async function requestExit(): Promise<void> {
  if (exitPending || quitting) return;
  if (starting && !isRecording(last)) {
    showError(new Error('Дождитесь запуска записи, затем остановите её или повторите выход.'));
    return;
  }
  exitPending = true;
  updateTray();
  try {
    if (backend !== null && backend.exitCode === null) {
      const state = await readStatus();
      if (isRecording(state)) {
        const answer = await dialog.showMessageBox({
          type: 'question',
          title: 'Запись ещё идёт',
          message: 'Остановить запись, сохранить результат и выйти?',
          buttons: ['Продолжить запись', 'Сохранить и выйти'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1) return;
        await finishRecording(
          readStatus,
          () => api('/api/capture/stop', true),
          () => pause(1000),
        );
      }
    }
    await autoCompletion;
    quitting = true;
    clearTimeout(poll);
    clearTimeout(autoPoll);
    window?.destroy();
    await shutdownBackend();
    tray?.destroy();
    app.quit();
  } catch (error) {
    showError(error);
  } finally {
    exitPending = false;
    if (!quitting) updateTray();
  }
}

async function shutdownBackend(): Promise<void> {
  const child = backend;
  if (child === null || child.exitCode !== null) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => {
      child.kill();
      done();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    if (child.connected) child.send('shutdown');
    else {
      child.kill();
    }
  });
}

async function launchBackend(): Promise<string> {
  return new Promise((ready, reject) => {
    const options = {
      execPath: process.execPath,
      windowsHide: true,
      silent: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        KADROSKOP_DESKTOP: '1',
        KADROSKOP_RESOURCES: assets,
        KADROSKOP_SESSIONS: app.isPackaged
          ? join(app.getPath('userData'), 'sessions')
          : resolve(__dirname, '../../sessions'),
      },
    };
    const child = fork(join(__dirname, 'backend.cjs'), [], options);
    backend = child;
    const timer = setTimeout(
      () => reject(new Error('Сборщик не запустился за 30 секунд.')),
      30_000,
    );
    child.stdout?.on('data', (data: Buffer) => log(data.toString()));
    child.stderr?.on('data', (data: Buffer) => log(data.toString()));
    child.on('error', reject);
    child.on('message', (message: unknown) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('url' in message) ||
        typeof message.url !== 'string'
      )
        return;
      const candidate = new URL(message.url);
      if (candidate.hostname !== '127.0.0.1' || candidate.protocol !== 'http:') return;
      clearTimeout(timer);
      ready(candidate.origin);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Сборщик завершился: ${code}`));
      if (!quitting && url) {
        healthy = false;
        clearTimeout(poll);
        updateTray();
        showError(new Error('Сборщик остановился. Перезапустите Кадроскоп.'));
      }
    });
  });
}

async function boot(): Promise<void> {
  mkdirSync(app.getPath('userData'), { recursive: true });
  logPath = join(app.getPath('userData'), 'desktop.log');
  if (existsSync(logPath) && statSync(logPath).size > 1024 * 1024) writeFileSync(logPath, '');
  try {
    autoEnabled =
      JSON.parse(readFileSync(join(app.getPath('userData'), 'auto-recording.json'), 'utf8'))
        .enabled === true;
  } catch {
    autoEnabled = false;
  }
  autoMessage = autoEnabled ? 'Ожидаю запуск Dota' : 'Автозапись выключена';
  url = await launchBackend();
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== `${url}/`)
      throw new Error('Недоступно');
  };
  ipcMain.handle('auto-recording:get', (event) => {
    trusted(event);
    return { enabled: autoEnabled, message: autoMessage };
  });
  ipcMain.handle('auto-recording:set', (event, enabled: unknown) => {
    trusted(event);
    if (typeof enabled !== 'boolean') throw new Error('Неверная настройка');
    setAuto(enabled);
    return { enabled: autoEnabled, message: autoMessage };
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'none'",
        ],
      },
    }),
  );
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Кадроскоп',
    backgroundColor: '#101619',
    icon: join(assets, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== url) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
    const marker = join(app.getPath('userData'), 'tray-introduced');
    if (!existsSync(marker)) {
      notify(
        'Кадроскоп работает в трее',
        'Запись продолжается. Чтобы завершить приложение, выберите «Выйти» в меню значка рядом с часами.',
      );
      writeFileSync(marker, '1');
    }
  });
  const visibility = () =>
    window?.webContents.send('desktop-visibility', window.isVisible() && !window.isMinimized());
  window.on('hide', visibility);
  window.on('show', visibility);
  window.on('minimize', visibility);
  window.on('restore', visibility);
  tray = new Tray(nativeImage.createFromPath(join(assets, 'icon.png')));
  tray.on('double-click', showWindow);
  updateTray();
  window.once('ready-to-show', showWindow);
  await window.loadURL(url);
  void pollStatus();
  void autoTick();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {
    /* Сбор продолжается без окна. */
  });
  app.on('before-quit', (event) => {
    if (!quitting) {
      event.preventDefault();
      void requestExit();
    }
  });
  void app
    .whenReady()
    .then(boot)
    .catch(async (error: unknown) => {
      showError(error);
      quitting = true;
      await shutdownBackend();
      app.quit();
    });
}
