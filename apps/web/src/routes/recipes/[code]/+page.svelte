<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  const { recipe } = $derived(data);

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function ratingPairs(r: import('@brewdial/shared').FeedbackRatings): [string, unknown][] {
    return Object.entries(r);
  }
</script>

<svelte:head>
  <title>{recipe.code} · {recipe.title} · BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="stack-tight">
    <p class="card-meta">
      <span class="code">{recipe.code}</span>
      <span class="muted"> · {recipe.method}</span>
      <span class="muted"> · {formatDate(recipe.createdAt)}</span>
    </p>
    <h1>{recipe.title}</h1>
  </div>

  {#if recipe.beanSnapshot && (recipe.beanSnapshot.name || recipe.beanSnapshot.roaster || recipe.beanSnapshot.roastDate)}
    <section class="stack-tight">
      <h2>Bean</h2>
      <dl class="dl">
        {#if recipe.beanSnapshot.name}
          <dt>Name</dt><dd>{recipe.beanSnapshot.name}</dd>
        {/if}
        {#if recipe.beanSnapshot.roaster}
          <dt>Roaster</dt><dd>{recipe.beanSnapshot.roaster}</dd>
        {/if}
        {#if recipe.beanSnapshot.roastDate}
          <dt>Roast date</dt><dd>{recipe.beanSnapshot.roastDate}</dd>
        {/if}
      </dl>
    </section>
  {/if}

  {#if Object.keys(recipe.params).length > 0}
    <section class="stack-tight">
      <h2>Params</h2>
      <dl class="dl">
        {#each Object.entries(recipe.params) as [key, value]}
          <dt>{key}</dt><dd>{value}</dd>
        {/each}
      </dl>
    </section>
  {/if}

  {#if recipe.steps.length > 0}
    <section class="stack-tight">
      <h2>Steps</h2>
      <ol>
        {#each recipe.steps as step, i (i)}
          <li>{step.note}</li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if recipe.intent && recipe.intent.length > 0}
    <section class="stack-tight">
      <h2>Intent</h2>
      <ul>
        {#each recipe.intent as item}
          <li>{item}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <div>
    <a class="btn" href={`/feedback/new?recipeCode=${recipe.code}`}>Add feedback</a>
  </div>

  <section class="stack-tight">
    <h2>Feedback</h2>
    {#if data.feedbackError}
      <ErrorPanel message={data.feedbackError} />
    {:else if data.feedback.length === 0}
      <p class="muted">No feedback yet.</p>
    {:else}
      <div class="stack">
        {#each data.feedback as fb (fb._id)}
          <article class="card">
            <p class="card-meta muted">{formatDate(fb.createdAt)}</p>
            <dl class="dl">
              {#each ratingPairs(fb.ratings) as [k, v]}
                <dt>{k}</dt><dd>{v}</dd>
              {/each}
            </dl>
            {#if fb.comment}
              <p>{fb.comment}</p>
            {/if}
            {#if fb.desiredDirection && fb.desiredDirection.length > 0}
              <ul>
                {#each fb.desiredDirection as dd}
                  <li>{dd}</li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</section>
