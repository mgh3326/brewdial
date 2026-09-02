import { useEffect } from 'react';
import { useHashPath } from './lib/useRoute';
import { migrateLocalGearOnce } from './lib/data/gear';
import Beans from './pages/Beans';
import Pick from './pages/Pick';
import BeanDetail from './pages/BeanDetail';
import RecipeDetail from './pages/RecipeDetail';
import Saved from './pages/Saved';
import BottomNav from './components/BottomNav';

export default function App() {
  const path = useHashPath();

  // One-time: seed the server-side user_gear from the legacy localStorage gear
  // (also warms the v1 identity). Fire-and-forget; failures are swallowed.
  useEffect(() => {
    void migrateLocalGearOnce();
  }, []);

  const recipeMatch = /^\/recipes\/(COF-[A-Za-z0-9-]+)$/.exec(path);
  if (recipeMatch) return <RecipeDetail key={recipeMatch[1]} code={recipeMatch[1]} />;

  const beanMatch = /^\/beans\/(.+)$/.exec(path);
  if (beanMatch) return <BeanDetail key={beanMatch[1]} id={decodeURIComponent(beanMatch[1])} />;

  if (path === '/')
    return (
      <>
        <Pick />
        <BottomNav />
      </>
    );

  // The old recipe list URL remains a working alias for the bean-centric list.
  if (path === '/beans' || path === '/recipes' || path === '/recipes/')
    return (
      <>
        <Beans />
        <BottomNav />
      </>
    );

  if (path === '/saved')
    return (
      <>
        <Saved />
        <BottomNav />
      </>
    );

  return (
    <div className="screen">
      <h2>없는 페이지</h2>
      <a
        className="card"
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          location.replace('#/');
        }}
      >
        홈으로
      </a>
    </div>
  );
}
