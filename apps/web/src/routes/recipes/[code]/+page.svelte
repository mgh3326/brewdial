<script lang="ts">
  import { onMount } from 'svelte';
  import { buildPourSchedule, formatSeconds } from '$lib/brew-timer/pour-schedule';
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  const { recipe } = $derived(data);
  const pourSchedule = $derived(buildPourSchedule(recipe));
  const canUseTimer = $derived(pourSchedule.phases.length > 0);

  let elapsedSec = $state(0);
  let isTimerRunning = $state(false);
  let lastAnnouncedPhase = $state(-1);
  let notificationPermission = $state<'default' | 'denied' | 'granted' | 'unsupported'>('unsupported');

  const currentPhase = $derived(
    pourSchedule.phases.find((phase) => elapsedSec >= phase.startSec && elapsedSec < phase.endSec) ??
      pourSchedule.phases.at(-1) ??
      null
  );
  const nextPhase = $derived(
    pourSchedule.phases.find((phase) => phase.startSec > elapsedSec) ?? null
  );
  const timerDone = $derived(canUseTimer && elapsedSec >= pourSchedule.totalSec);

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function ratingPairs(r: import('@brewdial/shared').FeedbackRatings): [string, unknown][] {
    return Object.entries(r);
  }

  function targetLabel(grams: number | undefined): string {
    return grams === undefined ? '목표 무게 미지정' : `${grams}g까지`;
  }

  function phaseTitle(phase: NonNullable<typeof currentPhase>): string {
    return `${phase.startLabel}–${phase.endLabel} · ${targetLabel(phase.targetWaterG)}`;
  }

  function announcePhase(phase: NonNullable<typeof currentPhase>): void {
    const title = `BrewDial: ${phase.startLabel} 푸어 시작`;
    const body = `${targetLabel(phase.targetWaterG)} · ${phase.note}`;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([120, 80, 120]);
    }
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      typeof document !== 'undefined' &&
      document.hidden
    ) {
      new Notification(title, { body });
    }
  }

  async function requestNotifications(): Promise<void> {
    if (typeof Notification === 'undefined') {
      notificationPermission = 'unsupported';
      return;
    }
    notificationPermission = await Notification.requestPermission();
  }

  function startTimer(): void {
    if (!canUseTimer) return;
    isTimerRunning = true;
    if (currentPhase && lastAnnouncedPhase !== currentPhase.index) {
      lastAnnouncedPhase = currentPhase.index;
      announcePhase(currentPhase);
    }
  }

  function pauseTimer(): void {
    isTimerRunning = false;
  }

  function resetTimer(): void {
    isTimerRunning = false;
    elapsedSec = 0;
    lastAnnouncedPhase = -1;
  }

  onMount(() => {
    notificationPermission =
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    const id = window.setInterval(() => {
      if (!isTimerRunning) return;
      elapsedSec = Math.min(elapsedSec + 1, pourSchedule.totalSec);
      const phase = pourSchedule.phases.find(
        (candidate) => elapsedSec >= candidate.startSec && elapsedSec < candidate.endSec
      );
      if (phase && phase.index !== lastAnnouncedPhase) {
        lastAnnouncedPhase = phase.index;
        announcePhase(phase);
      }
      if (elapsedSec >= pourSchedule.totalSec) {
        isTimerRunning = false;
      }
    }, 1000);
    return () => window.clearInterval(id);
  });
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

  {#if recipe.beanSnapshot && (recipe.beanSnapshot.name || recipe.beanSnapshot.roaster || recipe.beanSnapshot.roastDate || recipe.beanSnapshot.roastLevel || recipe.beanSnapshot.origin || recipe.beanSnapshot.process || recipe.beanSnapshot.notes)}
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
        {#if recipe.beanSnapshot.roastLevel}
          <dt>Roast level</dt><dd>{recipe.beanSnapshot.roastLevel}</dd>
        {/if}
        {#if recipe.beanSnapshot.origin}
          <dt>Origin</dt><dd>{recipe.beanSnapshot.origin}</dd>
        {/if}
        {#if recipe.beanSnapshot.process}
          <dt>Process</dt><dd>{recipe.beanSnapshot.process}</dd>
        {/if}
        {#if recipe.beanSnapshot.notes}
          <dt>Notes</dt><dd>{recipe.beanSnapshot.notes}</dd>
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

  {#if canUseTimer}
    <section class="card brew-timer" aria-label="Pouring timer">
      <div class="stack-tight">
        <p class="card-meta muted">Pouring timer</p>
        <div class="timer-display">{formatSeconds(elapsedSec)}</div>
        <p class="timer-status">
          {#if timerDone}
            추출 완료 · 목표 {formatSeconds(pourSchedule.totalSec)}
          {:else if currentPhase}
            지금: {phaseTitle(currentPhase)}
          {:else}
            타이머 준비
          {/if}
        </p>
        {#if currentPhase && !timerDone}
          <p class="muted">{currentPhase.note}</p>
        {/if}
        {#if nextPhase && !timerDone}
          <p class="muted">다음 알림: {phaseTitle(nextPhase)}</p>
        {/if}
        <p class="timer-help">
          시간 범위는 “그 구간을 다 채워서 계속 붓기”라기보다, 시작 시간에 붓기 시작해서 끝 시간쯤 목표 무게에 도달하라는 뜻입니다.
          목표 무게에 먼저 도달하면 다음 구간까지 기다리면 됩니다.
        </p>
      </div>
      <div class="row">
        {#if isTimerRunning}
          <button class="btn" type="button" onclick={pauseTimer}>Pause</button>
        {:else}
          <button class="btn" type="button" onclick={startTimer}>{elapsedSec > 0 ? 'Resume' : 'Start brew'}</button>
        {/if}
        <button class="btn btn-secondary" type="button" onclick={resetTimer}>Reset</button>
        {#if notificationPermission === 'default'}
          <button class="btn btn-secondary" type="button" onclick={requestNotifications}>알림 허용</button>
        {/if}
      </div>
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

  {#if recipe.notes}
    <section class="stack-tight">
      <h2>Notes</h2>
      <p>{recipe.notes}</p>
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

<style>
  .brew-timer {
    gap: 0.75rem;
  }

  .timer-display {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: clamp(2.5rem, 12vw, 5rem);
    font-weight: 800;
    line-height: 1;
    color: var(--accent-strong);
  }

  .timer-status {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }

  .timer-help {
    margin: 0;
    padding: 0.75rem;
    border-radius: var(--radius);
    background: var(--surface-muted);
    color: var(--text-muted);
    font-size: 0.95rem;
  }
</style>
