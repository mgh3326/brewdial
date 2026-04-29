<script lang="ts">
  import { onMount } from 'svelte';
  import {
    buildPourSchedule,
    buildBrewPhases,
    formatSeconds,
    getCurrentPhase,
    getCurrentBrewPhase,
    getExpectedWaterGForPhase,
    getBrewPhaseProgressRatio,
    roundToStep,
    type BrewPhase
  } from '$lib/brew-timer/pour-schedule';
  import { loadSoundPreference, saveSoundPreference } from '$lib/brew-timer/sound-preference';
  import { createPourAudio, type PourAudio } from '$lib/brew-timer/pour-audio';
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
  let soundEnabled = $state(true);
  let completionAnnounced = $state(false);
  let pourAudio: PourAudio | null = null;

  const brewPhases = $derived(buildBrewPhases(recipe));
  const currentBrewPhase = $derived(getCurrentBrewPhase(brewPhases, elapsedSec));
  const phaseExpectedG = $derived(
    currentBrewPhase ? getExpectedWaterGForPhase(currentBrewPhase, elapsedSec) : undefined
  );
  const phaseProgressPct = $derived(
    currentBrewPhase
      ? Math.round(getBrewPhaseProgressRatio(currentBrewPhase, elapsedSec) * 100)
      : 0
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

  function phaseTitle(phase: { startLabel: string; endLabel: string; targetWaterG?: number }): string {
    return `${phase.startLabel}–${phase.endLabel} · ${targetLabel(phase.targetWaterG)}`;
  }

  function announcePhase(phase: { startLabel: string; targetWaterG: number | undefined; note: string }): void {
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
    if (pourAudio) void pourAudio.unlock();
    if (
      currentBrewPhase &&
      (currentBrewPhase.kind === 'bloom' || currentBrewPhase.kind === 'pour') &&
      lastAnnouncedPhase !== currentBrewPhase.index
    ) {
      lastAnnouncedPhase = currentBrewPhase.index;
      announcePhase({
        startLabel: currentBrewPhase.startLabel,
        targetWaterG: currentBrewPhase.targetWaterG,
        note: currentBrewPhase.note ?? ''
      });
      if (soundEnabled) pourAudio?.playPhaseStart();
    }
  }

  function pauseTimer(): void {
    isTimerRunning = false;
  }

  function resetTimer(): void {
    isTimerRunning = false;
    elapsedSec = 0;
    lastAnnouncedPhase = -1;
    completionAnnounced = false;
  }

  function onSoundToggle(): void {
    saveSoundPreference(soundEnabled);
    if (soundEnabled) void pourAudio?.unlock();
  }

  function testSound(): void {
    if (!pourAudio) return;
    void pourAudio.unlock().then(() => pourAudio?.playPhaseStart());
  }

  onMount(() => {
    notificationPermission =
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    soundEnabled = loadSoundPreference();
    pourAudio = createPourAudio();

    const id = window.setInterval(() => {
      if (!isTimerRunning) return;
      elapsedSec = Math.min(elapsedSec + 1, pourSchedule.totalSec);
      const phase = getCurrentBrewPhase(brewPhases, elapsedSec);
      if (
        phase &&
        (phase.kind === 'bloom' || phase.kind === 'pour') &&
        phase.index !== lastAnnouncedPhase
      ) {
        lastAnnouncedPhase = phase.index;
        announcePhase({
          startLabel: phase.startLabel,
          targetWaterG: phase.targetWaterG,
          note: phase.note ?? ''
        });
        if (soundEnabled) pourAudio?.playPhaseStart();
      }
      if (elapsedSec >= pourSchedule.totalSec) {
        isTimerRunning = false;
        if (!completionAnnounced) {
          completionAnnounced = true;
          if (soundEnabled) pourAudio?.playComplete();
        }
      }
    }, 1000);

    return () => {
      window.clearInterval(id);
      pourAudio?.close();
      pourAudio = null;
    };
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
        {#if currentBrewPhase}
          {#if currentBrewPhase.kind === 'wait'}
            <p class="timer-status">기다리기 · 다음 푸어까지 {formatSeconds(currentBrewPhase.endSec - elapsedSec)}</p>
            <p class="muted">현재 누적 {currentBrewPhase.startWaterG}g — 목표 무게에 먼저 도달하면 다음 구간 시작 시간까지 기다리세요.</p>
          {:else if currentBrewPhase.kind === 'drawdown'}
            <p class="timer-status">드립 종료까지 {formatSeconds(currentBrewPhase.endSec - elapsedSec)}</p>
            <p class="muted">붓기를 멈추고 추출이 빠질 때까지 기다리세요. 목표 시간 {formatSeconds(brewPhases.at(-1)?.endSec ?? 0)}.</p>
          {:else}
            <p class="timer-status">
              지금: {currentBrewPhase.startLabel}–{currentBrewPhase.endLabel} ·
              {currentBrewPhase.targetWaterG !== undefined ? `${currentBrewPhase.targetWaterG}g까지` : '목표 무게 미지정'}
            </p>
            {#if currentBrewPhase.note}<p class="muted">{currentBrewPhase.note}</p>{/if}
            {#if phaseExpectedG !== undefined}
              <p class="timer-expected">지금쯤 약 <span class="timer-expected-num">{roundToStep(phaseExpectedG)}</span>g</p>
            {/if}
            {#if currentBrewPhase.targetWaterG !== undefined}
              <p class="timer-target muted">목표: {currentBrewPhase.endLabel}까지 {currentBrewPhase.targetWaterG}g</p>
            {/if}
            {#if currentBrewPhase.pourRateGPerSec !== undefined}
              <p class="timer-rate muted">속도: 약 {currentBrewPhase.pourRateGPerSec.toFixed(1)} g/s</p>
            {/if}
          {/if}
          <div
            class="phase-progress {currentBrewPhase.kind === 'wait' ? 'phase-kind-wait' : currentBrewPhase.kind === 'drawdown' ? 'phase-kind-drawdown' : ''}"
            role="progressbar"
            aria-valuenow={phaseProgressPct}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="현재 구간 진행률"
          >
            <div class="phase-progress-fill" style="width: {phaseProgressPct}%"></div>
          </div>
        {:else if timerDone}
          <p class="timer-status">추출 완료 · 목표 {formatSeconds(pourSchedule.totalSec)}</p>
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
        <label class="sound-toggle">
          <input type="checkbox" bind:checked={soundEnabled} onchange={onSoundToggle} />
          사운드
        </label>
        <button class="btn btn-secondary" type="button" onclick={testSound}>사운드 테스트</button>
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
              {#each ratingPairs(fb.ratings ?? {}) as [k, v]}
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

  .timer-expected {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: clamp(1.5rem, 6vw, 2.4rem);
    font-weight: 700;
    line-height: 1.1;
    color: var(--accent-strong);
  }

  .timer-expected-num {
    font-variant-numeric: tabular-nums;
  }

  .timer-target {
    margin: 0;
    font-size: 0.95rem;
  }

  .phase-progress {
    width: 100%;
    height: 0.5rem;
    background: var(--surface-muted);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .phase-progress-fill {
    height: 100%;
    background: var(--accent-strong);
    transition: width 200ms linear;
  }

  .sound-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.95rem;
    color: var(--text);
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-muted);
    cursor: pointer;
    min-height: 2.75rem;
  }

  .sound-toggle input[type='checkbox'] {
    accent-color: var(--accent);
    width: 1.1rem;
    height: 1.1rem;
  }

  .sound-toggle:focus-within {
    outline: 2px solid var(--accent-strong);
    outline-offset: 2px;
  }

  .timer-rate {
    margin: 0;
    font-size: 0.95rem;
  }

  .phase-progress.phase-kind-wait .phase-progress-fill {
    background: var(--surface-strong, var(--text-muted));
  }

  .phase-progress.phase-kind-drawdown .phase-progress-fill {
    background: var(--accent, var(--accent-strong));
    opacity: 0.7;
  }
</style>
