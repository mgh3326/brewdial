<script lang="ts">
  import { onMount } from 'svelte';
  import { listRecentRecipes } from '../lib/data/recipes';
  import type { RecipeDoc } from '../lib/domain';
  import RecipeCard from '../lib/ui/RecipeCard.svelte';

  let recipes = $state<RecipeDoc[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      recipes = await listRecentRecipes(100);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });
</script>

<section class="stack">
  <div class="row" style="justify-content: space-between">
    <h1>레시피</h1>
    <a class="btn" href="#/recipes/new">새 레시피</a>
  </div>

  {#if error}<div class="error-panel">불러오기 실패: {error}</div>{/if}

  {#if loading}
    <p class="muted">불러오는 중…</p>
  {:else if recipes.length === 0 && !error}
    <p class="empty">아직 레시피가 없어요.</p>
  {:else}
    <p class="sub">{recipes.length}개</p>
    <div class="stack">
      {#each recipes as recipe (recipe._id)}
        <RecipeCard {recipe} />
      {/each}
    </div>
  {/if}
</section>
