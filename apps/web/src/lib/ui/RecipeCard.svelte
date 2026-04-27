<script lang="ts">
  import type { RecipeDoc } from '@brewdial/shared';

  interface Props {
    recipe: RecipeDoc;
  }
  let { recipe }: Props = $props();

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  }
</script>

<a class="card" href={`/recipes/${recipe.code}`}>
  <p class="card-meta">
    <span class="code">{recipe.code}</span>
    <span class="muted"> · {recipe.method}</span>
  </p>
  <h3 class="card-title">{recipe.title}</h3>
  {#if recipe.beanSnapshot?.name || recipe.beanSnapshot?.roaster || recipe.beanSnapshot?.roastLevel || recipe.beanSnapshot?.origin}
    <p class="card-meta">
      {[
        recipe.beanSnapshot?.name,
        recipe.beanSnapshot?.roaster,
        recipe.beanSnapshot?.roastLevel,
        recipe.beanSnapshot?.origin
      ].filter(Boolean).join(' · ')}
    </p>
  {/if}
  {#if recipe.params?.grinder || recipe.params?.brewer}
    <p class="card-meta muted">
      {[recipe.params?.brewer, recipe.params?.grinder].filter(Boolean).join(' · ')}
    </p>
  {/if}
  <p class="card-meta muted">{formatDate(recipe.createdAt)}</p>
</a>
