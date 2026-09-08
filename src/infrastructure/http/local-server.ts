import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const LOOPBACK = '127.0.0.1';
const SSE_KEEPALIVE_MS = 15_000;

/** Хосты, с которых принимаем запросы: защита от DNS rebinding. */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Обработчик, отдающий один JSON-ответ. */
export interface JsonRoute {
  readonly path: string;
  handle(): Promise<unknown>;
}

/**
 * Обработчик потока событий. Возвращает функцию отписки, которую сервер
 * вызовет, когда клиент уйдёт.
 */
export interface StreamRoute {
  readonly path: string;
  subscribe(send: (payload: unknown) => void): () => void;
}

export interface LocalServerOptions {
  readonly port: number;
  readonly jsonRoutes: readonly JsonRoute[];
  readonly streamRoutes: readonly StreamRoute[];
  /** Каталог со собранным интерфейсом. Если его нет — отдаём подсказку. */
  readonly staticRoot: string | null;
}

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Локальный HTTP-сервер для интерфейса.
 *
 * Слушает только петлевой адрес и проверяет заголовок Host. Отчёт содержит
 * подробную опись машины, и отдавать его в сеть или произвольному сайту через
 * DNS rebinding нельзя. Заголовков CORS сервер не ставит намеренно: браузер
 * тогда не даст чужой странице прочитать ответ.
 */
export function startLocalServer(options: LocalServerOptions): Promise<RunningServer> {
  const server = createServer((request, response) => {
    void handle(request, response, options);
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(options.port, LOOPBACK, () => {
      server.removeListener('error', rejectPromise);
      resolvePromise({
        url: `http://${LOOPBACK}:${options.port}`,
        close: () => closeServer(server),
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.closeAllConnections();
    server.close(() => resolvePromise());
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalServerOptions,
): Promise<void> {
  if (!isHostAllowed(request)) {
    return send(response, 403, 'text/plain; charset=utf-8', 'Запрещено: чужой Host.');
  }

  const url = new URL(request.url ?? '/', `http://${LOOPBACK}`);
  const path = url.pathname;

  const stream = options.streamRoutes.find((route) => route.path === path);
  if (stream !== undefined) {
    return openStream(request, response, stream);
  }

  const json = options.jsonRoutes.find((route) => route.path === path);
  if (json !== undefined) {
    return sendJson(response, json);
  }

  return sendStatic(response, path, options.staticRoot);
}

function isHostAllowed(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (host === undefined) return false;
  const withoutPort = host.replace(/:\d+$/, '');
  return ALLOWED_HOSTS.has(withoutPort);
}

async function sendJson(response: ServerResponse, route: JsonRoute): Promise<void> {
  try {
    const payload = await route.handle();
    send(response, 200, 'application/json; charset=utf-8', JSON.stringify(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: message }));
  }
}

function openStream(
  request: IncomingMessage,
  response: ServerResponse,
  route: StreamRoute,
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const unsubscribe = route.subscribe((payload) => {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  // Комментарий раз в 15 секунд: без трафика посредники и сам браузер
  // закрывают простаивающее соединение.
  const keepalive = setInterval(() => response.write(': keepalive\n\n'), SSE_KEEPALIVE_MS);

  const stop = (): void => {
    clearInterval(keepalive);
    unsubscribe();
  };
  request.on('close', stop);
  response.on('error', stop);
}

const MISSING_UI = `<!doctype html><meta charset="utf-8">
<body style="font: 14px system-ui; padding: 2rem; background:#12141a; color:#e6e8ee">
<h1>Интерфейс не собран</h1>
<p>Выполните <code>npm run ui:build</code> — или запустите <code>npm run dev</code> для разработки.</p>`;

async function sendStatic(
  response: ServerResponse,
  path: string,
  staticRoot: string | null,
): Promise<void> {
  if (staticRoot === null) {
    return send(response, 200, 'text/html; charset=utf-8', MISSING_UI);
  }

  const filePath = resolveWithinRoot(staticRoot, path);
  if (filePath === null) {
    return send(response, 403, 'text/plain; charset=utf-8', 'Запрещено.');
  }

  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    const body = await readFile(target);
    send(response, 200, contentTypeOf(target), body);
  } catch {
    // Одностраничное приложение: неизвестный путь отдаём как index.html.
    try {
      send(
        response,
        200,
        'text/html; charset=utf-8',
        await readFile(join(staticRoot, 'index.html')),
      );
    } catch {
      send(response, 200, 'text/html; charset=utf-8', MISSING_UI);
    }
  }
}

/** Не выпускает запрос за пределы каталога со сборкой. */
function resolveWithinRoot(root: string, path: string): string | null {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, `.${normalize(path)}`);
  return candidate === absoluteRoot || candidate.startsWith(absoluteRoot + sep)
    ? candidate
    : null;
}

function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}
