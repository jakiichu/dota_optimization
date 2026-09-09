import { findSetting, parseGameConfig } from './game-config.ts';

/**
 * Правка конфига как текста, а не как набора настроек.
 *
 * Соблазн велик: разобрать файл, поменять значение и собрать обратно из
 * разобранного. Так делать нельзя — конфиг это авторский файл. В нём есть
 * комментарии, пустые строки, порядок и группировка, за которыми стоит чья-то
 * мысль. Пересборка из модели стёрла бы всё это молча, и человек лишился бы
 * своих пометок в обмен на одну изменённую цифру.
 *
 * Поэтому правим ровно ту строку, которую просили, и не трогаем остальные
 * байты файла.
 */

const COMMENT = '//';

/**
 * Ставит настройке новое значение.
 *
 * Если настройка встречается несколько раз, правится последняя: движок
 * выполняет строки по порядку, и именно она в итоге и сработает. Остальные
 * остаются как были — про повторы разбор конфига предупреждает отдельно, и
 * молча удалять чужие строки мы не станем.
 */
export function withSetting(text: string, name: string, value: string): string {
  const eol = endOfLine(text);
  const lines = text.split(/\r?\n/);
  const existing = findSetting(parseGameConfig('', text), name);

  if (existing === undefined) {
    return appendLine(lines, `${name} ${value}`).join(eol);
  }

  const at = existing.line - 1;
  const raw = lines[at];
  if (raw === undefined) return text;

  lines[at] = replaceValue(raw, existing.name, value);
  return lines.join(eol);
}

/** Убирает настройку целиком — все её вхождения. */
export function withoutSetting(text: string, name: string): string {
  const eol = endOfLine(text);
  const lowered = name.toLowerCase();
  const config = parseGameConfig('', text);
  const doomed = new Set(
    config.settings
      .filter((setting) => setting.name.toLowerCase() === lowered)
      .map((setting) => setting.line),
  );
  if (doomed.size === 0) return text;

  return text
    .split(/\r?\n/)
    .filter((_, index) => !doomed.has(index + 1))
    .join(eol);
}

/**
 * Чем в файле разделяются строки.
 *
 * Конфиг живёт на Windows, и игра пишет его с CRLF. Собрав файл обратно с
 * одними переводами строки, мы бы получили diff во весь файл на ровном месте.
 */
function endOfLine(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Меняет значение, сохраняя отступ, точку с запятой и комментарий в конце
 * строки. Комментарий человек писал для себя — он переживёт правку.
 */
function replaceValue(raw: string, name: string, value: string): string {
  const at = raw.indexOf(COMMENT);
  const code = at === -1 ? raw : raw.slice(0, at);
  const comment = at === -1 ? '' : raw.slice(at);

  const indent = /^\s*/.exec(code)?.[0] ?? '';
  const semicolon = /;\s*$/.test(code) ? ';' : '';
  const spacer = comment === '' ? '' : ' ';

  return `${indent}${name} ${value}${semicolon}${spacer}${comment}`;
}

/** Дописывает строку в конец, не плодя пустых строк и оставляя файл с переводом строки. */
function appendLine(lines: readonly string[], line: string): string[] {
  const kept = [...lines];
  while (kept.length > 0 && (kept.at(-1) ?? '').trim() === '') kept.pop();
  return [...kept, line, ''];
}
