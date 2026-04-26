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
  <title>BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="stack-tight">
    <h1>Dial in your next brew</h1>
    <p class="muted">
      Recipes, tasting feedback, and dial-in history for humans and agents.
    </p>
  </div>

  <div class="row">
    <a class="btn" href="/recipes/new">New recipe</a>
    <a class="btn btn-secondary" href="/recipes">All recipes</a>
  </div>

  {#if data.dbError}
    <ErrorPanel message={data.dbError} />
  {/if}

  <section class="stack-tight">
    <h2>Recent recipes</h2>
    {#if data.recipes.length === 0 && !data.dbError}
      <p class="muted">No recipes yet. Create your first one to start dialing in.</p>
    {:else}
      <div class="stack">
        {#each data.recipes as recipe (recipe._id)}
          <RecipeCard {recipe} />
        {/each}
      </div>
    {/if}
  </section>
</section>
