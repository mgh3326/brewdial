<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import RatingControl from '$lib/ui/RatingControl.svelte';
  import type { ActionData, PageData } from './$types';

  interface Props {
    data: PageData;
    form: ActionData;
  }
  let { data, form }: Props = $props();

  const v = $derived(form?.values ?? {});
  const recipe = $derived(data.recipe);
</script>

<svelte:head>
  <title>Feedback for {recipe.code} · BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="stack-tight">
    <p class="card-meta">
      <span class="code">{recipe.code}</span>
      <span class="muted"> · {recipe.method}</span>
    </p>
    <h1>Feedback for {recipe.title}</h1>
  </div>

  {#if form?.errors && form.errors.length > 0}
    <ErrorPanel message={form.errors.join(' · ')} />
  {/if}

  <form method="POST" class="stack">
    <input type="hidden" name="recipeCode" value={recipe.code} />

    <RatingControl name="overall" label="Overall (1–5)" min={1} max={5} value={v.overall} />
    <RatingControl name="sweetness" label="Sweetness" value={v.sweetness} />
    <RatingControl name="burnt" label="Burnt" value={v.burnt} />
    <RatingControl name="bitter" label="Bitter" value={v.bitter} />
    <RatingControl name="sour" label="Sour" value={v.sour} />
    <RatingControl name="body" label="Body" value={v.body} />
    <RatingControl name="astringency" label="Astringency" value={v.astringency} />
    <RatingControl name="clarity" label="Clarity" value={v.clarity} />

    <div class="field">
      <label for="comment">Comment</label>
      <textarea id="comment" name="comment">{v.comment ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="desiredDirectionText">Desired direction (one per line)</label>
      <textarea id="desiredDirectionText" name="desiredDirectionText">{v.desiredDirectionText ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="tempC">Actual temp (°C)</label>
      <input id="tempC" name="tempC" inputmode="decimal" value={v.tempC ?? ''} />
    </div>

    <div class="field">
      <label for="grind">Actual grind</label>
      <input id="grind" name="grind" value={v.grind ?? ''} />
    </div>

    <div class="field">
      <label for="timeSec">Actual time (s)</label>
      <input id="timeSec" name="timeSec" inputmode="numeric" value={v.timeSec ?? ''} />
    </div>

    <button type="submit" class="btn">Submit feedback</button>
  </form>
</section>
