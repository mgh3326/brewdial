<script lang="ts">
  import type { RecipeDoc } from '../domain';

  let { recipe }: { recipe: RecipeDoc } = $props();

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  }

  const beanLine = $derived(
    [
      recipe.beanSnapshot?.name,
      recipe.beanSnapshot?.roaster,
      recipe.beanSnapshot?.roastLevel,
      recipe.beanSnapshot?.origin
    ]
      .filter(Boolean)
      .join(' · ')
  );
  const gearLine = $derived(
    [recipe.params?.brewer, recipe.params?.grinder].filter(Boolean).join(' · ')
  );
</script>

<a class="card" href={`#/recipes/${recipe.code}`}>
  <p class="card-meta">
    <span class="code">{recipe.code}</span>
    <span class="muted">· {recipe.method}</span>
    {#if recipe.createdBy === 'agent'}<span class="badge-ai">✨ AI 생성</span>{/if}
  </p>
  <h3 class="card-title">{recipe.title}</h3>
  {#if beanLine}<p class="card-meta">{beanLine}</p>{/if}
  {#if gearLine}<p class="card-meta muted">{gearLine}</p>{/if}
  <p class="card-meta muted">{formatDate(recipe.createdAt)}</p>
</a>
