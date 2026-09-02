import { useHashPath } from '../lib/useRoute';
import { whichTab, type TabKey } from '../lib/nav';

// Toss-style floating bottom tab bar (rounded capsule, elevated).
// App mounts it only on the three primary tab pages.
interface TabDef {
  key: TabKey;
  href: string;
  label: string;
}

const TABS: readonly TabDef[] = [
  { key: 'pick', href: '#/', label: '뽑기' },
  { key: 'beans', href: '#/beans', label: '원두' },
  { key: 'saved', href: '#/saved', label: '저장함' },
];

function PickIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3h10v7.5A5 5 0 0 1 12 15.5a5 5 0 0 1-5-5zM9 20h6M12 15.5V20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BeansIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 4c-3 2-4 8-1 13 2 3 6 3 8 0 3-5 2-11-1-13-2 1-4 1-6 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 7c2 3 3 6 3 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SavedIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.6L6 20V5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function BottomNav() {
  const path = useHashPath();
  const active = whichTab(path);

  return (
    <nav className="bottom-nav" role="navigation" aria-label="주요 메뉴">
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <a
            key={t.key}
            className={`bottom-nav-item${isActive ? ' active' : ''}`}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
          >
            {t.key === 'pick' ? <PickIcon /> : t.key === 'beans' ? <BeansIcon /> : <SavedIcon />}
            <span className="bottom-nav-label">{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
