import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/**
 * Полоса поверх окна, пока что-то грузится.
 *
 * Одна на всё приложение: экрану не нужно знать, что кто-то в фоне обновляет
 * список записей, а человеку — нужно. Заодно видно, что кеш не соврал, а
 * данные и правда перезапрашиваются.
 */
export function LoadingBar(): React.JSX.Element | null {
  // Фоновый опрос статуса не должен мигать полосой каждую секунду.
  const fetching = useIsFetching({ predicate: (query) => query.queryKey[0] !== 'capture-status' });
  const mutating = useIsMutating();

  if (fetching + mutating === 0) return null;

  return (
    <div className="loading-bar" role="progressbar" aria-label="Загрузка">
      <div className="loading-bar-track" />
    </div>
  );
}
