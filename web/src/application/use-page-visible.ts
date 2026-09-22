import { useEffect, useState } from 'react';

declare global {
  interface Window {
    kadroskopDesktop?: { onVisibility(callback: (visible: boolean) => void): () => void };
  }
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    const unsubscribe = window.kadroskopDesktop?.onVisibility(setVisible);
    return () => { document.removeEventListener('visibilitychange', update); unsubscribe?.(); };
  }, []);
  return visible;
}
