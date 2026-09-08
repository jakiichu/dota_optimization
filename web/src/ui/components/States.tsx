/**
 * Состояния экрана: загрузка, ошибка, пусто.
 *
 * Вынесено в одно место, потому что раньше каждый экран изобретал свой текст —
 * и «жду данных» выглядело по-разному в зависимости от того, кто его писал.
 */

/** Скелет вместо содержимого при первой загрузке. */
export function Skeleton({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}

export function LoadingState({ what }: { what: string }): React.JSX.Element {
  return (
    <>
      <div className="notice">{what}</div>
      <Skeleton />
    </>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="notice error">{message}</div>
      {onRetry !== undefined && (
        <button type="button" className="button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="notice">{children}</div>;
}

/**
 * Заголовок раздела с местом под действия справа.
 *
 * `stale` подсвечивает, что показаны данные из кеша и идёт обновление: иначе
 * кеш выглядит как «ничего не происходит».
 */
export function SectionHeader({
  title,
  subtitle,
  stale = false,
  children,
}: {
  title: string;
  subtitle?: string;
  stale?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="section-header">
      <div>
        <h1 className="section-title">
          {title}
          {stale && <span className="section-stale">обновляю…</span>}
        </h1>
        {subtitle !== undefined && <div className="section-subtitle">{subtitle}</div>}
      </div>
      {children !== undefined && <div className="section-actions">{children}</div>}
    </header>
  );
}
