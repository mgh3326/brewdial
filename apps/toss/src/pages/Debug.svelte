<script lang="ts">
  import { onMount } from 'svelte';
  import { unlock, playNow, scheduleIn, audioState, isReady } from '../lib/tone';
  import { getEnv, setKeepAwake, haptic } from '../lib/toss';
  import { hasSupabaseConfig } from '../lib/supabase';
  import { listRecentRecipes, createRecipe } from '../lib/data/recipes';

  let env = $state<string>('…');
  let keepAwake = $state<boolean | null>(null);
  let hapticOk = $state<boolean | null>(null);
  let ready = $state(false);
  let soundEnabled = $state(true);
  let flash = $state(false);
  let lines = $state<string[]>([]);
  let dbBusy = $state(false);

  function log(msg: string) {
    lines = [`${new Date().toLocaleTimeString()}  ${msg}`, ...lines].slice(0, 40);
  }
  function doFlash() {
    flash = true;
    setTimeout(() => (flash = false), 220);
  }

  onMount(async () => {
    env = await getEnv();
    log(`실행 환경: ${env}`);
    keepAwake = await setKeepAwake(true);
    log(`화면 항상 켜짐: ${keepAwake ? '적용됨' : '미적용(브리지 없음/미지원)'}`);
  });

  async function toneTest() {
    await unlock();
    ready = isReady();
    doFlash();
    hapticOk = await haptic('basicMedium');
    if (soundEnabled) {
      playNow();
      log(`톤 재생 (audioState=${audioState()}) · 햅틱 ${hapticOk ? 'OK' : '미지원'}`);
    } else {
      log(`사운드 꺼짐 · 햅틱 ${hapticOk ? 'OK' : '미지원'} · 플래시만`);
    }
  }
  async function lockTest() {
    await unlock();
    ready = isReady();
    hapticOk = await haptic('tickMedium');
    if (!soundEnabled) {
      log('사운드 꺼짐 — 예약 생략');
      return;
    }
    scheduleIn(3);
    log('3초 뒤 톤 예약 — 화면 잠갔다 켜서 확인');
  }
  async function hapticTest() {
    hapticOk = await haptic('success');
    doFlash();
    log(`햅틱 테스트(success) → ${hapticOk ? '진동 발생' : '미지원(브라우저/구버전)'}`);
  }
  async function dbReadTest() {
    if (dbBusy) return;
    dbBusy = true;
    try {
      const r = await listRecentRecipes(5);
      const l = r[0];
      log(`DB 읽기 OK — 최근 ${r.length}건${l ? `, 최신 ${l.code} (${l.title})` : ''}`);
    } catch (e) {
      log(`DB 읽기 실패: ${(e as Error).message}`);
    } finally {
      dbBusy = false;
    }
  }
  async function dbCreateSample() {
    if (dbBusy) return;
    dbBusy = true;
    try {
      const r = await createRecipe({
        method: 'v60',
        title: '테스트 V60',
        params: { doseG: 15, waterG: 240, tempC: 92 },
        steps: [{ atSec: 0, waterG: 40, note: 'Bloom' }]
      });
      log(`DB 쓰기 OK — 새 레시피 ${r.code} 생성`);
    } catch (e) {
      log(`DB 쓰기 실패: ${(e as Error).message}`);
    } finally {
      dbBusy = false;
    }
  }
</script>

<div class="flash" class:on={flash}></div>

<section class="stack">
  <div class="stack-tight">
    <h1>BrewDial · Debug</h1>
    <p class="sub">오디오/햅틱/화면/DB 브리지 진단용 화면.</p>
  </div>

  <div class="card">
    <dl class="status">
      <dt>실행 환경</dt><dd>{env}</dd>
      <dt>오디오 상태</dt><dd>{ready ? 'running' : audioState()}</dd>
      <dt>화면 항상 켜짐</dt><dd>{keepAwake === null ? '…' : keepAwake ? '✅' : '⚠️ 미적용'}</dd>
      <dt>햅틱</dt><dd>{hapticOk === null ? '— (버튼 눌러 확인)' : hapticOk ? '✅ 지원' : '⚠️ 미지원'}</dd>
    </dl>
  </div>

  <div class="toggle card">
    <span>타이머 사운드</span>
    <label><input type="checkbox" bind:checked={soundEnabled} /> {soundEnabled ? '켜짐' : '꺼짐'}</label>
  </div>

  <button class="btn btn-block" onclick={toneTest}>🔔 톤+햅틱 테스트</button>
  <button class="btn btn-secondary btn-block" onclick={lockTest}>⏱️ 3초 뒤 톤 (잠금 테스트)</button>
  <button class="btn btn-secondary btn-block" onclick={hapticTest}>📳 햅틱만 (무음 확인)</button>

  <div class="card">
    <p class="sub" style="margin:0 0 8px">DB (Supabase){hasSupabaseConfig ? '' : ' — ⚠️ 환경변수 없음'}</p>
    <button class="btn btn-secondary btn-block" onclick={dbReadTest} disabled={dbBusy}>📥 DB 읽기 테스트</button>
    <button class="btn btn-secondary btn-block" style="margin-top:8px" onclick={dbCreateSample} disabled={dbBusy}>📝 샘플 레시피 생성</button>
  </div>

  <div class="card">
    <p class="sub" style="margin-bottom:8px">로그</p>
    <p class="log">{lines.join('\n')}</p>
  </div>
</section>

<style>
  .flash {
    position: fixed;
    inset: 0;
    background: var(--brand);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
    z-index: 10;
  }
  .flash.on {
    opacity: 0.35;
  }
</style>
