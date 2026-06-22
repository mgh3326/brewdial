import { useHashPath } from './lib/useRoute';
import Beans from './pages/Beans';
import BeanDetail from './pages/BeanDetail';
import NewRecipe from './pages/NewRecipe';
import RecipeDetail from './pages/RecipeDetail';

export default function App() {
  const path = useHashPath();

  const recipeMatch = /^\/recipes\/(COF-[A-Za-z0-9-]+)$/.exec(path);
  if (recipeMatch) return <RecipeDetail key={recipeMatch[1]} code={recipeMatch[1]} />;

  if (path === '/recipes/new') return <NewRecipe />;

  const beanMatch = /^\/beans\/(.+)$/.exec(path);
  if (beanMatch) return <BeanDetail key={beanMatch[1]} id={decodeURIComponent(beanMatch[1])} />;

  // Home = bean-centric list (ROB-610). '/recipes' kept as an alias.
  if (path === '/' || path === '/recipes' || path === '/recipes/') return <Beans />;

  return (
    <div className="screen">
      <h2>없는 페이지</h2>
      <a className="card" href="#/">
        홈으로
      </a>
    </div>
  );
}
