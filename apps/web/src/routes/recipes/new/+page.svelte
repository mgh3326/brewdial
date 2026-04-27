<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import type { ActionData } from './$types';

  interface Props {
    form: ActionData;
  }
  let { form }: Props = $props();

  const v = $derived(form?.values ?? {});
</script>

<svelte:head>
  <title>New recipe · BrewDial</title>
</svelte:head>

<section class="stack">
  <h1>New recipe</h1>

  {#if form?.errors && form.errors.length > 0}
    <ErrorPanel message={form.errors.join(' · ')} />
  {/if}

  <form method="POST" class="stack">
    <div class="field">
      <label for="title">Title</label>
      <input id="title" name="title" required value={v.title ?? ''} />
    </div>

    <div class="field">
      <label for="method">Method</label>
      <select id="method" name="method" required>
        {#each ['v60', 'espresso', 'aeropress', 'kalita', 'other'] as opt}
          <option value={opt} selected={(v.method ?? 'v60') === opt}>{opt}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="beanName">Bean name</label>
      <input id="beanName" name="beanName" value={v.beanName ?? ''} />
    </div>

    <div class="field">
      <label for="roaster">Roaster</label>
      <input id="roaster" name="roaster" value={v.roaster ?? ''} />
    </div>

    <div class="field">
      <label for="roastDate">Roast date</label>
      <input id="roastDate" name="roastDate" type="date" value={v.roastDate ?? ''} />
    </div>

    <div class="field">
      <label for="roastLevel">Roast level</label>
      <input id="roastLevel" name="roastLevel" value={v.roastLevel ?? ''} />
    </div>

    <div class="field">
      <label for="origin">Origin</label>
      <input id="origin" name="origin" value={v.origin ?? ''} />
    </div>

    <div class="field">
      <label for="process">Process</label>
      <input id="process" name="process" value={v.process ?? ''} />
    </div>

    <div class="field">
      <label for="beanNotes">Bean notes</label>
      <textarea id="beanNotes" name="beanNotes">{v.beanNotes ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="doseG">Dose (g)</label>
      <input id="doseG" name="doseG" inputmode="decimal" value={v.doseG ?? ''} />
    </div>

    <div class="field">
      <label for="waterG">Water (g)</label>
      <input id="waterG" name="waterG" inputmode="decimal" value={v.waterG ?? ''} />
    </div>

    <div class="field">
      <label for="tempC">Temp (°C)</label>
      <input id="tempC" name="tempC" inputmode="decimal" value={v.tempC ?? ''} />
    </div>

    <div class="field">
      <label for="grind">Grind</label>
      <input id="grind" name="grind" value={v.grind ?? ''} />
    </div>

    <div class="field">
      <label for="grinder">Grinder</label>
      <input id="grinder" name="grinder" value={v.grinder ?? ''} />
    </div>

    <div class="field">
      <label for="brewer">Brewer</label>
      <input id="brewer" name="brewer" value={v.brewer ?? ''} />
    </div>

    <div class="field">
      <label for="targetTimeSec">Target time (s)</label>
      <input id="targetTimeSec" name="targetTimeSec" inputmode="numeric" value={v.targetTimeSec ?? ''} />
    </div>

    <div class="field">
      <label for="intentText">Intent (one per line)</label>
      <textarea id="intentText" name="intentText">{v.intentText ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="notes">Notes</label>
      <textarea id="notes" name="notes">{v.notes ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="stepsText">Steps (one note per line)</label>
      <textarea id="stepsText" name="stepsText">{v.stepsText ?? ''}</textarea>
    </div>

    <button type="submit" class="btn">Create recipe</button>
  </form>
</section>
