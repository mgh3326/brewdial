<script lang="ts">
  import Home from './pages/Home.svelte';
  import Recipes from './pages/Recipes.svelte';
  import RecipeDetail from './pages/RecipeDetail.svelte';
  import Debug from './pages/Debug.svelte';

  function parseHash(): string {
    const h = (typeof location !== 'undefined' ? location.hash : '') || '#/';
    return h.replace(/^#/, '') || '/';
  }

  let path = $state(parseHash());
  $effect(() => {
    const on = () => (path = parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  });

  const recipeMatch = $derived(/^\/recipes\/(COF-[A-Za-z0-9-]+)$/.exec(path));
  const view = $derived(
    path === '/'
      ? 'home'
      : path === '/recipes' || path === '/recipes/'
        ? 'recipes'
        : path === '/recipes/new'
          ? 'new'
          : recipeMatch
            ? 'recipe'
            : path === '/debug'
              ? 'debug'
              : 'notfound'
  );
  const navActive = $derived(view === 'home' ? 'home' : path.startsWith('/recipes') ? 'recipes' : '');
</script>

<header class="app-header">
  <div class="app-header-inner">
    <a class="app-title" href="#/">☕ BrewDial</a>
    <nav class="app-nav">
      <a href="#/" class:active={navActive === 'home'}>홈</a>
      <a href="#/recipes" class:active={navActive === 'recipes'}>레시피</a>
    </nav>
  </div>
</header>

<main class="app-main">
  {#if view === 'home'}
    <Home />
  {:else if view === 'recipes'}
    <Recipes />
  {:else if view === 'recipe' && recipeMatch}
    {#key recipeMatch[1]}
      <RecipeDetail code={recipeMatch[1]} />
    {/key}
  {:else if view === 'new'}
    <section class="stack">
      <h1>새 레시피</h1>
      <p class="muted">곧 추가됩니다 (증분 2: 입력 폼).</p>
      <a class="btn btn-secondary" href="#/recipes">레시피 목록</a>
    </section>
  {:else if view === 'debug'}
    <Debug />
  {:else}
    <section class="stack">
      <h1>없는 페이지</h1>
      <a class="btn" href="#/">홈으로</a>
    </section>
  {/if}
</main>
