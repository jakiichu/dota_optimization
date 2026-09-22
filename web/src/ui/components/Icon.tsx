export type IconName = 'overview' | 'capture' | 'settings' | 'compare' | 'activity' | 'arrow' | 'check' | 'chevron';

const PATHS: Record<IconName, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  capture: 'M4 4h16v16H4z M8 12h2l2-5 2 10 2-5h2',
  settings: 'M4 7h7m4 0h5 M4 17h3m4 0h9 M11 4v6 M7 14v6',
  compare: 'M4 7h15m-4-4 4 4-4 4 M20 17H5m4-4-4 4 4 4',
  activity: 'M2 12h5l3-8 4 16 3-8h5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 5 7 7-7 7',
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }): React.JSX.Element {
  return <svg className={`icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>;
}
