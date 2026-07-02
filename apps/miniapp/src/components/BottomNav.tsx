import { useHashPath } from '../lib/useRoute';
import { whichTab, type TabKey } from '../lib/nav';

// ROB-633 — Toss-style floating bottom tab bar (rounded capsule, elevated),
// shown only on the home + saved tab pages (App gates mounting).
interface TabDef {
  key: TabKey;
  href: string;
  label: string;
}

const TABS: readonly TabDef[] = [
  { key: 'home', href: '#/', label: '홈' },
  { key: 'saved', href: '#/saved', label: '저장함' },
];

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
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
            {t.key === 'home' ? <HomeIcon /> : <SavedIcon />}
            <span className="bottom-nav-label">{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
