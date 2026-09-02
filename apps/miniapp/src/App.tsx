import { useEffect } from 'react';
import { useHashPath } from './lib/useRoute';
import { migrateLocalGearOnce } from './lib/data/gear';
import Beans from './pages/Beans';
import BeanDetail from './pages/BeanDetail';
import RecipeDetail from './pages/RecipeDetail';
import RecipeFeedback from './pages/RecipeFeedback';
import EditRecipe from './pages/EditRecipe';
import NewRecipe from './pages/NewRecipe';
import Saved from './pages/Saved';
import BottomNav from './components/BottomNav';
import { asRecipeCode } from './lib/nav';

export default function App() {
  const path = useHashPath();

  // One-time: seed the server-side user_gear from the legacy localStorage gear
  // (also warms the v1 identity). Fire-and-forget; failures are swallowed.
  useEffect(() => {
    void migrateLocalGearOnce();
  }, []);

  if (path === '/new-recipe' || path === '/recipes/new') return <NewRecipe />;

  const feedbackMatch = /^\/recipes\/(COF-[A-Za-z0-9-]+)\/feedback$/.exec(path);
  if (feedbackMatch) {
    const code = asRecipeCode(feedbackMatch[1]);
    if (code) return <RecipeFeedback key={code} code={code} />;
  }

  const editMatch = /^\/recipes\/(COF-[A-Za-z0-9-]+)\/edit$/.exec(path);
  if (editMatch) {
    const code = asRecipeCode(editMatch[1]);
    if (code) return <EditRecipe key={code} code={code} />;
  }

  const recipeMatch = /^\/recipes\/(COF-[A-Za-z0-9-]+)$/.exec(path);
  if (recipeMatch) return <RecipeDetail key={recipeMatch[1]} code={recipeMatch[1]} />;

  const beanMatch = /^\/beans\/(.+)$/.exec(path);
  if (beanMatch) return <BeanDetail key={beanMatch[1]} id={decodeURIComponent(beanMatch[1])} />;

  // Home = bean-centric list (ROB-610). '/recipes' kept as an alias.
  if (path === '/' || path === '/recipes' || path === '/recipes/')
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
