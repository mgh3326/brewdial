import { useHashPath } from './lib/useRoute';
import Home from './pages/Home';
import NewRecipe from './pages/NewRecipe';
import RecipeDetail from './pages/RecipeDetail';

export default function App() {
  const path = useHashPath();

  const recipeMatch = /^\/recipes\/(COF-[A-Za-z0-9-]+)$/.exec(path);
  if (recipeMatch) return <RecipeDetail key={recipeMatch[1]} code={recipeMatch[1]} />;

  if (path === '/recipes/new') return <NewRecipe />;

  // Single main screen — the recipe list. (Home and the old /recipes list were
  // duplicates, so they're merged and the bottom tab bar is removed.)
  if (path === '/' || path === '/recipes' || path === '/recipes/') return <Home />;

  return (
    <div className="screen">
      <h2>없는 페이지</h2>
      <a className="card" href="#/">
        홈으로
      </a>
    </div>
  );
}
