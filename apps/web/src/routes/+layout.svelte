<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<header class="app-header">
  <div class="app-header-inner">
    <a class="app-title" href="/">BrewDial</a>
    <nav class="app-nav" aria-label="Primary">
      <a href="/">Home</a>
      <a href="/recipes">Recipes</a>
      <a href="/recipes/new">New recipe</a>
    </nav>
  </div>
</header>

<main class="app-main">
  {@render children()}
</main>
