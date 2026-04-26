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
</section>
