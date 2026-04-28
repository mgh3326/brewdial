<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import RatingControl from '$lib/ui/RatingControl.svelte';
  import { QUICK_FEEDBACK_TAGS } from '@brewdial/shared';
  import type { ActionData, PageData } from './$types';

  interface Props {
    data: PageData;
    form: ActionData;
  }
  let { data, form }: Props = $props();

  const v = $derived(form?.values ?? {});
  const selectedTags: string[] = $derived(Array.isArray(v.quickTags) ? v.quickTags : []);
  let detailsOpen = $state(false);
</script>

<svelte:head>
  <title
    >{data.recipe ? `Feedback for ${data.recipe.code}` : 'Feedback'} · BrewDial</title
  >
</svelte:head>

<section class="stack">
  {#if data.dbError}
    <h1>Feedback</h1>
    <ErrorPanel message={data.dbError} />
    <p><a href="/">Back to home</a></p>
  {:else if data.recipe}
    <div class="stack-tight">
      <p class="card-meta">
        <span class="code">{data.recipe.code}</span>
        <span class="muted"> · {data.recipe.method}</span>
      </p>
      <h1>Feedback for {data.recipe.title}</h1>
    </div>

    {#if form?.errors && form.errors.length > 0}
      <ErrorPanel message={form.errors.join(' · ')} />
    {/if}

    <form method="POST" class="stack">
      <input type="hidden" name="recipeCode" value={data.recipe.code} />

      <div class="field">
        <label for="rawComment">오늘의 한 줄 (자유롭게)</label>
        <textarea
          id="rawComment"
          name="rawComment"
          rows="4"
          placeholder="예) 산미는 좋았는데 끝맛이 살짝 떫었어요"
        >{v.rawComment ?? ''}</textarea>
      </div>

      <fieldset class="quick-tags">
        <legend>빠른 태그 (선택)</legend>
        <div class="quick-tags-options">
          {#each QUICK_FEEDBACK_TAGS as tag}
            <label class="quick-tag">
              <input
                type="checkbox"
                name="quickTags"
                value={tag}
                checked={selectedTags.includes(tag)}
              />
              <span>{tag}</span>
            </label>
          {/each}
        </div>
      </fieldset>

      <details bind:open={detailsOpen}>
        <summary>자세히 기록하기</summary>
        <div class="stack">
          <RatingControl name="overall" label="Overall (1–5)" min={1} max={5} value={v.overall} />
          <RatingControl name="sweetness" label="Sweetness" value={v.sweetness} />
          <RatingControl name="burnt" label="Burnt" value={v.burnt} />
          <RatingControl name="bitter" label="Bitter" value={v.bitter} />
          <RatingControl name="sour" label="Sour" value={v.sour} />
          <RatingControl name="body" label="Body" value={v.body} />
          <RatingControl name="astringency" label="Astringency" value={v.astringency} />
          <RatingControl name="clarity" label="Clarity" value={v.clarity} />

          <div class="field">
            <label for="desiredDirectionText">Desired direction (one per line)</label>
            <textarea id="desiredDirectionText" name="desiredDirectionText"
              >{v.desiredDirectionText ?? ''}</textarea
            >
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
        </div>
      </details>

      <button type="submit" class="btn">저장</button>
    </form>
  {/if}
</section>

<style>
  .quick-tags-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .quick-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-muted);
    cursor: pointer;
    min-height: 2.25rem;
  }
  .quick-tag input[type='checkbox'] {
    accent-color: var(--accent);
  }
</style>
