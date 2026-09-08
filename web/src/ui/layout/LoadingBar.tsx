import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/**
 * Полоса поверх окна, пока что-то грузится.
 *
 * Одна на всё приложение: экрану не нужно знать, что кто-то в фоне обновляет
 * список записей, а человеку — нужно. Заодно видно, что кеш не соврал, а
 * данные и правда перезапрашиваются.
 */
export function LoadingBar(): React.JSX.Element | null {
  const fetching = useIsFetching();
  const mutating = useIsMutating();

  if (fetching + mutating === 0) return null;

  return (
    <div className="loading-bar" role="progressbar" aria-label="Загрузка">
      <div className="loading-bar-track" />
    </div>
  );
}
