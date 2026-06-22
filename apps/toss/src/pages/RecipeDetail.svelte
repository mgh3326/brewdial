<script lang="ts">
  import { onMount } from 'svelte';
  import {
    buildPourSchedule,
    buildBrewPhases,
    formatSeconds,
    getCurrentBrewPhase,
    getExpectedWaterGForPhase,
    getBrewPhaseProgressRatio,
    isBrewPhaseResting,
    roundToStep,
    type BrewPhase
  } from '../lib/brew-timer/pour-schedule';
  import { loadSoundPreference, saveSoundPreference } from '../lib/brew-timer/sound-preference';
  import { createPourAudio, type PourAudio } from '../lib/brew-timer/pour-audio';
  import { haptic } from '../lib/toss';
  import { getRecipeByCode } from '../lib/data/recipes';
  import { listFeedbackByRecipe } from '../lib/data/feedback';
  import type { FeedbackDoc, FeedbackRatings, RecipeCode, RecipeDoc } from '../lib/domain';

  let { code }: { code: string } = $props();

  let recipe = $state<RecipeDoc | null>(null);
  let feedback = $state<FeedbackDoc[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let elapsedSec = $state(0);
  let isTimerRunning = $state(false);
  let lastAnnouncedPhase = $state(-1);
  let soundEnabled = $state(true);
  let completionAnnounced = $state(false);
  let pourAudio: PourAudio | null = null;

  const pourSchedule = $derived(recipe ? buildPourSchedule(recipe) : { totalSec: 0, phases: [] });
  const brewPhases = $derived(recipe ? buildBrewPhases(recipe) : []);
  const canUseTimer = $derived(pourSchedule.phases.length > 0);

  const currentBrewPhase = $derived(getCurrentBrewPhase(brewPhases, elapsedSec));
  const phaseExpectedG = $derived(
    currentBrewPhase ? getExpectedWaterGForPhase(currentBrewPhase, elapsedSec) : undefined
  );
  const phaseProgressPct = $derived(
    currentBrewPhase ? Math.round(getBrewPhaseProgressRatio(currentBrewPhase, elapsedSec) * 100) : 0
  );
  const inRestTail = $derived(
    currentBrewPhase ? isBrewPhaseResting(currentBrewPhase, elapsedSec) : false
  );
  const isLastBrewPhase = $derived(
    currentBrewPhase !== null && currentBrewPhase.index === brewPhases.length - 1
  );
  const nextPhase = $derived(brewPhases.find((phase) => phase.startSec > elapsedSec) ?? null);
  const timerDone = $derived(canUseTimer && elapsedSec >= pourSchedule.totalSec);
  const dialProgress = $derived(
    pourSchedule.totalSec > 0 ? Math.min(1, elapsedSec / pourSchedule.totalSec) : 0
  );

  function pourLabel(index: number): string {
    return index === 0 ? 'Bloom' : `Pour ${index}`;
  }
  function phasePillLabel(phase: BrewPhase): string {
    if (phase.kind === 'bloom') return 'Bloom';
    const pourCountBefore = brewPhases.slice(0, phase.index).filter((p) => p.kind === 'pour').length;
    return `Pour ${pourCountBefore + 1}`;
  }
  function pourState(phase: { startSec: number; endSec: number }): 'done' | 'now' | 'upcoming' {
    if (elapsedSec >= phase.endSec) return 'done';
    if (elapsedSec >= phase.startSec) return 'now';
    return 'upcoming';
  }
  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
  function targetLabel(grams: number | undefined): string {
    return grams === undefined ? '목표 무게 미지정' : `${grams}g까지`;
  }
  function phaseTitle(phase: BrewPhase): string {
    return `${phase.startLabel}–${phase.pourEndLabel} · ${targetLabel(phase.targetWaterG)}`;
  }
  function ratingPairs(r: FeedbackRatings): [string, unknown][] {
    return Object.entries(r);
  }

  // Phase cue: haptic always fires (works on silent), tone only when enabled.
  function announcePhase(): void {
    void haptic('tickMedium');
    if (soundEnabled) pourAudio?.playPhaseStart();
  }

  function startTimer(): void {
    if (!canUseTimer) return;
    isTimerRunning = true;
    if (pourAudio) void pourAudio.unlock();
    if (currentBrewPhase && !inRestTail && lastAnnouncedPhase !== currentBrewPhase.index) {
      lastAnnouncedPhase = currentBrewPhase.index;
      announcePhase();
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
    void pourAudio?.unlock();
    void haptic('basicMedium');
    if (soundEnabled) pourAudio?.playPhaseStart();
  }

  onMount(() => {
    soundEnabled = loadSoundPreference();
    pourAudio = createPourAudio();

    const id = window.setInterval(() => {
      if (!isTimerRunning) return;
      elapsedSec = Math.min(elapsedSec + 1, pourSchedule.totalSec);
      const phase = getCurrentBrewPhase(brewPhases, elapsedSec);
      if (phase && phase.index !== lastAnnouncedPhase) {
        lastAnnouncedPhase = phase.index;
        announcePhase();
      }
      if (elapsedSec >= pourSchedule.totalSec && !completionAnnounced) {
        isTimerRunning = false;
        completionAnnounced = true;
        void haptic('success');
        if (soundEnabled) pourAudio?.playComplete();
      }
    }, 1000);

    void (async () => {
      try {
        const [r, fb] = await Promise.all([
          getRecipeByCode(code as RecipeCode),
          listFeedbackByRecipe(code as RecipeCode)
        ]);
        if (!r) loadError = '레시피를 찾을 수 없어요.';
        recipe = r;
        feedback = fb;
      } catch (e) {
        loadError = (e as Error).message;
      } finally {
        loading = false;
      }
    })();

    return () => {
      window.clearInterval(id);
      pourAudio?.close();
      pourAudio = null;
    };
  });
</script>

{#if loading}
  <p class="muted">불러오는 중…</p>
{:else if loadError || !recipe}
  <section class="stack">
    <div class="error-panel">{loadError ?? '레시피를 찾을 수 없어요.'}</div>
    <a class="btn btn-secondary" href="#/recipes">레시피 목록</a>
  </section>
{:else}
  <section class="stack">
    <div class="stack-tight">
      <p class="card-meta">
        <span class="code">{recipe.code}</span>
        <span class="muted">· {recipe.method}</span>
        <span class="muted">· {formatDate(recipe.createdAt)}</span>
        {#if recipe.createdBy === 'agent'}<span class="badge-ai">✨ AI 생성</span>{/if}
      </p>
      <h1>{recipe.title}</h1>
      {#if recipe.createdBy === 'agent'}
        <p class="sub">이 레시피는 AI가 생성했어요. 직접 맛을 확인하고 피드백을 남겨주세요.</p>
      {/if}
    </div>

    {#if recipe.beanSnapshot && (recipe.beanSnapshot.name || recipe.beanSnapshot.roaster || recipe.beanSnapshot.origin || recipe.beanSnapshot.process || recipe.beanSnapshot.roastLevel)}
      <section class="stack-tight">
        <h2>원두</h2>
        <dl class="dl">
          {#if recipe.beanSnapshot.name}<dt>이름</dt><dd>{recipe.beanSnapshot.name}</dd>{/if}
          {#if recipe.beanSnapshot.roaster}<dt>로스터</dt><dd>{recipe.beanSnapshot.roaster}</dd>{/if}
          {#if recipe.beanSnapshot.roastLevel}<dt>로스팅</dt><dd>{recipe.beanSnapshot.roastLevel}</dd>{/if}
          {#if recipe.beanSnapshot.origin}<dt>원산지</dt><dd>{recipe.beanSnapshot.origin}</dd>{/if}
          {#if recipe.beanSnapshot.process}<dt>가공</dt><dd>{recipe.beanSnapshot.process}</dd>{/if}
        </dl>
      </section>
    {/if}

    {#if Object.keys(recipe.params).length > 0}
      <section class="stack-tight">
        <h2>파라미터</h2>
        <dl class="dl">
          {#each Object.entries(recipe.params) as [key, value]}
            <dt>{key}</dt><dd>{value}</dd>
          {/each}
        </dl>
      </section>
    {/if}

    {#if canUseTimer}
      <section class="card brew-timer" aria-label="추출 타이머">
        <div class="dial-wrap">
          {#if currentBrewPhase}
            <span class="phase-pill">{phasePillLabel(currentBrewPhase)}{inRestTail ? ' · 쉬는 중' : ''}</span>
          {:else if timerDone}
            <span class="phase-pill">완료</span>
          {/if}
          <div class="dial" style="--dial-progress: {dialProgress}" role="timer" aria-label="추출 경과 시간">
            <div class="clock">
              <div class="time">{formatSeconds(elapsedSec)}</div>
              <div class="of">/ {formatSeconds(pourSchedule.totalSec)}</div>
            </div>
          </div>
        </div>

        <div class="stack-tight">
          {#if currentBrewPhase}
            <p class="timer-status">
              지금: {currentBrewPhase.startLabel}–{currentBrewPhase.pourEndLabel} ·
              {currentBrewPhase.targetWaterG !== undefined ? `${currentBrewPhase.targetWaterG}g까지` : '목표 무게 미지정'}
            </p>
            {#if currentBrewPhase.note}<p class="muted">{currentBrewPhase.note}</p>{/if}
            {#if inRestTail}
              {#if isLastBrewPhase}
                <p class="timer-rest">붓기 끝 · 추출 완료까지 <span class="timer-rest-num">{formatSeconds(currentBrewPhase.endSec - elapsedSec)}</span></p>
              {:else}
                <p class="timer-rest">붓기 끝 · 다음 푸어까지 <span class="timer-rest-num">{formatSeconds(currentBrewPhase.endSec - elapsedSec)}</span></p>
              {/if}
            {:else}
              {#if phaseExpectedG !== undefined}
                <p class="timer-expected">지금쯤 약 <span class="timer-expected-num">{roundToStep(phaseExpectedG)}</span>g</p>
              {/if}
              {#if currentBrewPhase.targetWaterG !== undefined}
                <p class="timer-target muted">목표: {currentBrewPhase.pourEndLabel}까지 {currentBrewPhase.targetWaterG}g</p>
              {/if}
            {/if}
            <div class="phase-progress {inRestTail ? 'phase-kind-wait' : ''}" role="progressbar" aria-valuenow={phaseProgressPct} aria-valuemin="0" aria-valuemax="100" aria-label="현재 구간 진행률">
              <div class="phase-progress-fill" style="width: {phaseProgressPct}%"></div>
            </div>
          {:else if timerDone}
            <p class="timer-status">추출 완료 · 목표 {formatSeconds(pourSchedule.totalSec)}</p>
          {/if}
          {#if nextPhase && !timerDone}
            <p class="muted">다음: {phaseTitle(nextPhase)}</p>
          {/if}
        </div>

        <ul class="pour-list">
          {#each brewPhases as phase (phase.index)}
            <li class="pour-row {pourState(phase)}">
              <span class="label">{pourLabel(phase.index)}</span>
              <span class="time muted">
                {phase.startLabel} – {phase.pourEndLabel}
                {#if phase.pourEndSec < phase.endSec}
                  <span class="time-detail">쉬기 {phase.pourEndLabel} – {phase.endLabel}</span>
                {/if}
              </span>
              <span class="grams">{phase.targetWaterG !== undefined ? `${phase.targetWaterG} g` : '—'}</span>
            </li>
          {/each}
        </ul>

        <div class="row">
          {#if isTimerRunning}
            <button class="btn" type="button" onclick={pauseTimer}>일시정지</button>
          {:else}
            <button class="btn" type="button" onclick={startTimer}>{elapsedSec > 0 ? '계속' : '추출 시작'}</button>
          {/if}
          <button class="btn btn-secondary" type="button" onclick={resetTimer}>리셋</button>
          <label class="sound-toggle">
            <input type="checkbox" bind:checked={soundEnabled} onchange={onSoundToggle} />
            사운드
          </label>
          <button class="btn btn-secondary" type="button" onclick={testSound}>테스트</button>
        </div>
      </section>
    {/if}

    {#if recipe.steps.length > 0}
      <section class="stack-tight">
        <h2>스텝</h2>
        <ol>{#each recipe.steps as step, i (i)}<li>{step.note}</li>{/each}</ol>
      </section>
    {/if}

    {#if recipe.notes}
      <section class="stack-tight"><h2>메모</h2><p>{recipe.notes}</p></section>
    {/if}

    <div><a class="btn" href={`#/feedback/new?recipeCode=${recipe.code}`}>피드백 추가</a></div>

    <section class="stack-tight">
      <h2>피드백</h2>
      {#if feedback.length === 0}
        <p class="muted">아직 피드백이 없어요.</p>
      {:else}
        <div class="stack">
          {#each feedback as fb (fb._id)}
            <article class="card">
              <p class="card-meta muted">{formatDate(fb.createdAt)}</p>
              {#if fb.ratings}
                <dl class="dl">{#each ratingPairs(fb.ratings) as [k, v]}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
              {/if}
              {#if fb.comment}<p>{fb.comment}</p>{/if}
              {#if fb.rawComment}<p>{fb.rawComment}</p>{/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </section>
{/if}

<style>
  .brew-timer {
    gap: 12px;
    display: flex;
    flex-direction: column;
  }
  .dial-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
  }
  .phase-pill {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--accent-strong);
    background: var(--accent-soft);
    padding: 4px 10px;
    border-radius: 999px;
  }
  .dial {
    width: 168px;
    height: 168px;
    border-radius: 50%;
    background: conic-gradient(
      var(--accent) calc(var(--dial-progress) * 360deg),
      var(--surface-muted) 0
    );
    display: grid;
    place-items: center;
  }
  .clock {
    width: 132px;
    height: 132px;
    border-radius: 50%;
    background: var(--card);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .clock .time {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 2rem;
    font-weight: 700;
  }
  .clock .of {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .timer-status {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }
  .timer-expected {
    margin: 0;
    font-family: var(--font-mono);
    font-size: clamp(1.5rem, 6vw, 2.2rem);
    font-weight: 700;
    color: var(--accent-strong);
  }
  .timer-expected-num {
    font-variant-numeric: tabular-nums;
  }
  .timer-target {
    margin: 0;
    font-size: 0.92rem;
  }
  .timer-rest {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .timer-rest-num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
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
  .phase-progress.phase-kind-wait .phase-progress-fill {
    background: var(--text-muted);
  }
  .pour-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pour-row {
    display: grid;
    grid-template-columns: 4.5rem 1fr auto;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    align-items: center;
    font-size: 0.9rem;
  }
  .pour-row .grams {
    font-family: var(--font-mono);
    color: var(--accent-strong);
    font-weight: 700;
  }
  .pour-row .time-detail {
    display: block;
    margin-top: 2px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .pour-row.done {
    color: var(--text-muted);
    background: var(--surface-muted);
  }
  .pour-row.now {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .sound-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.92rem;
    padding: 0 10px;
    min-height: 44px;
  }
  .sound-toggle input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
  }
  ol {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
