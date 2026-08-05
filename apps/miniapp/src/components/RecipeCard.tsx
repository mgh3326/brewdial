import type { RecipeDoc } from '../lib/domain';
import { METHOD_LABELS } from '../lib/recipe-presets';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function RecipeCard({ recipe, mine }: { recipe: RecipeDoc; mine?: boolean }) {
  const bean = [
    recipe.beanSnapshot?.name,
    recipe.beanSnapshot?.roaster,
    recipe.beanSnapshot?.roastLevel,
    recipe.beanSnapshot?.origin,
  ]
    .filter(Boolean)
    .join(' · ');
  const gear = [recipe.params?.brewer, recipe.params?.grinder].filter(Boolean).join(' · ');

  return (
    <a className="card" href={`#/recipes/${recipe.code}`}>
      <p className="card-meta">
        <span className="code">{recipe.code}</span>
        <span className="muted">· {METHOD_LABELS[recipe.method]}</span>
        {recipe.createdBy === 'agent' && <span className="badge-ai">✨ AI 생성</span>}
        {recipe.isOfficial && <span className="badge-official">⭐ 공식</span>}
        {mine && <span className="badge-mine">👤 내 레시피</span>}
      </p>
      <p className="card-title">{recipe.title}</p>
      {bean && <p className="card-meta">{bean}</p>}
      {gear && <p className="card-meta muted">{gear}</p>}
      <p className="card-meta muted">{formatDate(recipe.createdAt)}</p>
    </a>
  );
}
