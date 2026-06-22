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
      recipes = await listRecentRecipes(5);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });
</script>

<section class="stack">
  <div class="stack-tight">
    <h1>다음 브루를 다이얼인 ☕</h1>
    <p class="muted">레시피 · 추출 타이머 · 피드백을 한 곳에서.</p>
  </div>

  <div class="row">
    <a class="btn" href="#/recipes/new">새 레시피</a>
    <a class="btn btn-secondary" href="#/recipes">전체 레시피</a>
  </div>

  {#if error}<div class="error-panel">불러오기 실패: {error}</div>{/if}

  <section class="stack-tight">
    <h2>최근 레시피</h2>
    {#if loading}
      <p class="muted">불러오는 중…</p>
    {:else if recipes.length === 0 && !error}
      <p class="empty">아직 레시피가 없어요. 첫 레시피를 만들어 보세요.</p>
    {:else}
      <div class="stack">
        {#each recipes as recipe (recipe._id)}
          <RecipeCard {recipe} />
        {/each}
      </div>
    {/if}
  </section>
</section>
