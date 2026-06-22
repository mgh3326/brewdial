import { useEffect, useState } from 'react';

function currentPath(): string {
  const h = typeof location !== 'undefined' ? location.hash : '';
  return (h || '#/').replace(/^#/, '') || '/';
}

// Minimal hash router — reliable inside the Toss WebView, no dependency.
export function useHashPath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}
