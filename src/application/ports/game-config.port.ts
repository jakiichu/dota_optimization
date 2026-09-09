/**
 * Доступ к файлу конфига игры.
 *
 * Единственное место в приложении, которое **пишет** в чужие файлы, — и потому
 * порт описан отдельно и узко: прочитать, записать целиком, удалить, положить
 * копию на рабочий стол. Ничего сверх этого сценариям не нужно, а значит и
 * реализации не позволено больше.
 */

export interface StoredConfig {
  /** Куда игра смотрит за конфигом — независимо от того, есть файл или нет. */
  readonly path: string;
  /** Содержимое. `null` означает, что файла нет, а не что он пуст. */
  readonly text: string | null;
}

export interface ConfigWriteResult {
  readonly path: string;
  /**
   * Куда уехала прежняя версия.
   *
   * `null` — если её не было. Перезапись без копии недопустима: конфиг человек
   * собирал месяцами, а нажать «Удалить» можно за секунду.
   */
  readonly backupPath: string | null;
}

export interface GameConfigStore {
  /** `null` — игра не найдена, и говорить о конфиге нечего. */
  read(): Promise<StoredConfig | null>;
  write(text: string): Promise<ConfigWriteResult>;
  remove(): Promise<ConfigWriteResult>;
  /** Возвращает путь к созданному файлу — человеку нужно знать, куда смотреть. */
  copyToDesktop(): Promise<string>;
}
