<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import RecipeCard from '$lib/ui/RecipeCard.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Recipes · BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="row">
    <h1>Recipes</h1>
    <a class="btn" href="/recipes/new">New recipe</a>
  </div>

  {#if data.dbError}
    <ErrorPanel message={data.dbError} />
  {/if}

  {#if data.recipes.length === 0 && !data.dbError}
    <p class="muted">No recipes yet.</p>
  {:else}
    <div class="stack">
      {#each data.recipes as recipe (recipe._id)}
        <RecipeCard {recipe} />
      {/each}
    </div>
  {/if}

  {#if data.totalPages > 1}
    <nav class="pager" aria-label="레시피 페이지">
      {#if data.page > 1}
        <a class="btn btn-secondary" href="?page={data.page - 1}" rel="prev">← 이전</a>
      {:else}
        <span class="btn btn-secondary pager-disabled" aria-disabled="true">← 이전</span>
      {/if}
      <span class="pager-status muted">{data.page} / {data.totalPages} 페이지</span>
      {#if data.page < data.totalPages}
        <a class="btn btn-secondary" href="?page={data.page + 1}" rel="next">다음 →</a>
      {:else}
        <span class="btn btn-secondary pager-disabled" aria-disabled="true">다음 →</span>
      {/if}
    </nav>
  {/if}
</section>

<style>
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .pager-status {
    font-variant-numeric: tabular-nums;
  }

  .pager-disabled {
    opacity: 0.5;
    pointer-events: none;
  }
</style>
