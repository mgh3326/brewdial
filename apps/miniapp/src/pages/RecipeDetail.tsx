import { Top } from '@toss/tds-mobile';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  buildBrewPhases,
  buildPourSchedule,
  formatSeconds,
  getBrewPhaseProgressRatio,
  getCurrentBrewPhase,
  getExpectedWaterGForPhase,
  isBrewPhaseResting,
  roundToStep,
  type BrewPhase,
} from '../lib/brew-timer/pour-schedule';
import { loadSoundPreference, saveSoundPreference } from '../lib/brew-timer/sound-preference';
import { createPourAudio, type PourAudio } from '../lib/brew-timer/pour-audio';
import { haptic, setKeepAwake } from '../lib/toss';
import { getRecipeByCode } from '../lib/data/recipes';
import { getMyCollections, saveRecipe, upsertCalibration } from '../lib/data/user-content';
import { listFeedbackByRecipe } from '../lib/data/feedback';
import FeedbackForm from '../components/FeedbackForm';
import { METHOD_LABELS } from '../lib/recipe-presets';
import { paramLabel, ratingLabel } from '../lib/labels';
import { grindDisplay, parseClicks, suggestDripperAdaptation, suggestGrinderClicks } from '../lib/domain';
import { listGrinders } from '../lib/data/grinders';
import { listDrippers } from '../lib/data/drippers';
import { loadGear } from '../lib/gear-preferences';
import type {
  Calibration,
  DripperInfo,
  FeedbackDoc,
  GrindSpec,
  GrinderInfo,
  RecipeCode,
  RecipeDoc
} from '../lib/domain';

const SIZE_MATCH_LABEL: Record<string, string> = {
  ok: '적정',
  undersized: '도즈 적음',
  oversized: '도즈 많음'
};
const GRIND_SHIFT_LABEL: Record<string, string> = { coarser: '굵게', finer: '곱게', none: '그대로' };
const POUR_SHIFT_LABEL: Record<string, string> = {
  gentler: '교반 ↓',
  more_agitation: '교반 ↑',
  fewer_pours: '푸어 횟수 ↓',
  more_pours: '푸어 횟수 ↑',
  none: '그대로'
};
const CONFIDENCE_LABEL: Record<string, string> = { high: '신뢰 높음', medium: '참고', low: '주의' };

type Tab = 'timer' | 'recipe' | 'feedback';

function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function RecipeDetail({ code }: { code: string }) {
  const [recipe, setRecipe] = useState<RecipeDoc | null>(null);
  const [feedback, setFeedback] = useState<FeedbackDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('timer');
  const [saved, setSaved] = useState(false);
  const [savingSave, setSavingSave] = useState(false);
  const [grinders, setGrinders] = useState<GrinderInfo[]>([]);
  const [selGrinder, setSelGrinder] = useState<string>('');
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [calInput, setCalInput] = useState<string>('');
  const [savingCal, setSavingCal] = useState(false);
  const [drippers, setDrippers] = useState<DripperInfo[]>([]);
  const [selDripper, setSelDripper] = useState<string>('');

  // Reflect already-saved state on load (best-effort; web_local/toss_anon identity).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mc = await getMyCollections();
        const codes = new Set(
          (mc.savedRecipes as Array<{ recipe_code?: string }>)
            .map((s) => s.recipe_code)
            .filter((x): x is string => Boolean(x))
        );
        if (alive && codes.has(code)) setSaved(true);
      } catch {
        // collections unavailable — leave default (unsaved)
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);

  // ROB-611: load the grinder registry; default the selector to the user's gear.
  useEffect(() => {
    void (async () => {
      try {
        const list = await listGrinders();
        setGrinders(list);
        const preferred = loadGear().grinder;
        const match = preferred ? list.find((g) => g.name === preferred) : undefined;
        setSelGrinder(match ? match.name : (list[0]?.name ?? ''));
      } catch {
        // registry unavailable — grind section falls back to target text
      }
    })();
  }, []);

  // ROB-611 (D): load the user's grinder-pair calibrations (best-effort).
  async function loadCalibrations(): Promise<void> {
    try {
      const mc = await getMyCollections();
      const rows = mc.calibration as Array<{
        from_label?: string;
        to_label?: string;
        anchor_method?: string;
        samples?: { fromClicks: number; toClicks: number }[];
      }>;
      setCalibrations(
        rows
          .filter((r) => r.from_label && r.to_label)
          .map((r) => ({
            fromGrinder: r.from_label as string,
            toGrinder: r.to_label as string,
            anchorMethod: r.anchor_method,
            samples: Array.isArray(r.samples) ? r.samples : []
          }))
      );
    } catch {
      // collections unavailable — conversions stay uncalibrated
    }
  }
  useEffect(() => {
    void loadCalibrations();
  }, []);

  // ROB-612: load the dripper registry for the adaptation helper.
  useEffect(() => {
    void (async () => {
      try {
        const list = await listDrippers();
        setDrippers(list);
        setSelDripper(list[0]?.name ?? '');
      } catch {
        // registry unavailable — dripper section falls back
      }
    })();
  }, []);

  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const audioRef = useRef<PourAudio | null>(null);
  const runningRef = useRef(false);
  const soundRef = useRef(true);
  const lastAnnouncedRef = useRef(-1);
  const completedRef = useRef(false);
  const totalRef = useRef(0);
  const phasesRef = useRef<BrewPhase[]>([]);

  const schedule = useMemo(
    () => (recipe ? buildPourSchedule(recipe) : { totalSec: 0, phases: [] }),
    [recipe]
  );
  const brewPhases = useMemo(() => (recipe ? buildBrewPhases(recipe) : []), [recipe]);

  useEffect(() => {
    totalRef.current = schedule.totalSec;
    phasesRef.current = brewPhases;
  }, [schedule, brewPhases]);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  function announce() {
    void haptic('tickMedium');
    if (soundRef.current) audioRef.current?.playPhaseStart();
  }

  useEffect(() => {
    const pref = loadSoundPreference();
    setSoundEnabled(pref);
    soundRef.current = pref;
    audioRef.current = createPourAudio();

    const id = window.setInterval(() => {
      if (!runningRef.current) return;
      setElapsed((e) => Math.min(e + 1, totalRef.current));
    }, 1000);

    void (async () => {
      try {
        const [r, fb] = await Promise.all([
          getRecipeByCode(code as RecipeCode),
          listFeedbackByRecipe(code as RecipeCode),
        ]);
        if (!r) setLoadError('레시피를 찾을 수 없어요.');
        setRecipe(r);
        setFeedback(fb);
      } catch (e) {
        setLoadError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      window.clearInterval(id);
      void setKeepAwake(false);
      audioRef.current?.close();
      audioRef.current = null;
    };
  }, [code]);

  useEffect(() => {
    if (elapsed > 0) {
      const phase = getCurrentBrewPhase(brewPhases, elapsed);
      if (phase && phase.index !== lastAnnouncedRef.current) {
        lastAnnouncedRef.current = phase.index;
        announce();
      }
    }
    if (schedule.totalSec > 0 && elapsed >= schedule.totalSec && !completedRef.current) {
      completedRef.current = true;
      runningRef.current = false;
      setRunning(false);
      void setKeepAwake(false);
      void haptic('success');
      if (soundRef.current) audioRef.current?.playComplete();
    }
  }, [elapsed, brewPhases, schedule.totalSec]);

  const canUseTimer = schedule.phases.length > 0;
  const currentPhase = getCurrentBrewPhase(brewPhases, elapsed);
  const inRest = currentPhase ? isBrewPhaseResting(currentPhase, elapsed) : false;
  const expectedG = currentPhase ? getExpectedWaterGForPhase(currentPhase, elapsed) : undefined;
  const phasePct = currentPhase
    ? Math.round(getBrewPhaseProgressRatio(currentPhase, elapsed) * 100)
    : 0;
  const isLast = currentPhase != null && currentPhase.index === brewPhases.length - 1;
  const nextPhase = brewPhases.find((p) => p.startSec > elapsed) ?? null;
  const timerDone = canUseTimer && elapsed >= schedule.totalSec;
  const dialProgress = schedule.totalSec > 0 ? Math.min(1, elapsed / schedule.totalSec) : 0;

  function start() {
    if (!canUseTimer) return;
    if (completedRef.current || elapsed >= schedule.totalSec) {
      reset(); // finished → back to start; avoids a frozen fake-running state
      return;
    }
    runningRef.current = true;
    setRunning(true);
    void setKeepAwake(true);
    void audioRef.current?.unlock();
    const phase = getCurrentBrewPhase(brewPhases, elapsed);
    if (phase && !inRest && lastAnnouncedRef.current !== phase.index) {
      lastAnnouncedRef.current = phase.index;
      announce();
    }
  }
  function pause() {
    runningRef.current = false;
    setRunning(false);
    void setKeepAwake(false);
  }
  function reset() {
    runningRef.current = false;
    setRunning(false);
    void setKeepAwake(false);
    setElapsed(0);
    lastAnnouncedRef.current = -1;
    completedRef.current = false;
  }
  function onSound(v: boolean) {
    setSoundEnabled(v);
    soundRef.current = v;
    saveSoundPreference(v);
    if (v) void audioRef.current?.unlock();
  }
  function pourLabel(i: number) {
    return i === 0 ? 'Bloom' : `Pour ${i}`;
  }
  function pourState(p: BrewPhase): string {
    if (elapsed >= p.endSec) return 'done';
    if (elapsed >= p.startSec) return 'now';
    return 'upcoming';
  }
  function phasePill(p: BrewPhase): string {
    if (p.kind === 'bloom') return 'Bloom';
    const before = brewPhases.slice(0, p.index).filter((x) => x.kind === 'pour').length;
    return `Pour ${before + 1}`;
  }

  if (loading) {
    return (
      <div className="screen">
        <p className="muted">불러오는 중…</p>
      </div>
    );
  }
  if (loadError || !recipe) {
    return (
      <div className="screen">
        <div className="error-panel">{loadError ?? '레시피를 찾을 수 없어요.'}</div>
        <a className="card" href="#/recipes">
          레시피 목록으로
        </a>
      </div>
    );
  }

  const grindField = recipe.params.grind;
  const grindSpec: GrindSpec | null =
    grindField != null && typeof grindField === 'object' ? grindField : null;
  const selInfo = grinders.find((g) => g.name === selGrinder) ?? null;
  const grindSuggestion =
    grindSpec && selInfo
      ? suggestGrinderClicks(grindSpec, recipe.method, selInfo, grinders, calibrations)
      : null;
  const grindRef =
    grindSpec?.perGrinder?.find((p) => p.source === 'measured') ?? grindSpec?.perGrinder?.[0] ?? null;
  const grindRefClicks = grindRef ? parseClicks(grindRef.clicks) : null;
  // Calibration only makes sense for an INTERPOLATED grinder (not a direct measured
  // match), since the offset is applied inside the band-interpolation path.
  const canCalibrate =
    !!grindRef &&
    grindRefClicks != null &&
    (grindSuggestion?.basis === 'relative-band' || grindSuggestion?.basis === 'calibrated');

  const dripperLayer = recipe.dripperPortability ?? null;
  const dripperOrigin: DripperInfo | null = dripperLayer
    ? (drippers.find((d) => d.name.toLowerCase() === dripperLayer.origin.dripper.toLowerCase()) ?? {
        name: dripperLayer.origin.dripper,
        class: 'bed_restricted'
      })
    : null;
  const selDripperInfo = drippers.find((d) => d.name === selDripper) ?? null;
  const dripperAdaptation =
    dripperLayer && dripperOrigin && selDripperInfo
      ? suggestDripperAdaptation(dripperOrigin, recipe.params.doseG, selDripperInfo)
      : null;

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>{recipe.title}</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={13}>
            {recipe.code} · {METHOD_LABELS[recipe.method]} · {formatDateTime(recipe.createdAt)}
          </Top.SubtitleParagraph>
        }
      />
      <div className="screen">
        {recipe.createdBy === 'agent' && (
          <p className="card-meta">
            <span className="badge-ai">✨ AI 생성</span>
            <span className="muted">맛을 확인하고 피드백을 남겨주세요.</span>
          </p>
        )}

        <div className="row">
          <button
            type="button"
            className={`btn-save${saved ? ' saved' : ''}`}
            disabled={savingSave || saved}
            onClick={() => {
              if (savingSave || saved) return;
              setSavingSave(true);
              saveRecipe(recipe.code)
                .then(() => setSaved(true))
                .catch(() => {
                  /* best-effort; v1 save is non-critical */
                })
                .finally(() => setSavingSave(false));
            }}
          >
            {saved ? '저장됨 ✓' : savingSave ? '저장 중…' : '레시피 저장'}
          </button>
        </div>

        <div className="seg" role="tablist" aria-label="레시피 보기">
          <button
            role="tab"
            id="tab-timer"
            aria-selected={tab === 'timer'}
            aria-controls="panel-timer"
            className={tab === 'timer' ? 'active' : undefined}
            onClick={() => setTab('timer')}
          >
            타이머
          </button>
          <button
            role="tab"
            id="tab-recipe"
            aria-selected={tab === 'recipe'}
            aria-controls="panel-recipe"
            className={tab === 'recipe' ? 'active' : undefined}
            onClick={() => setTab('recipe')}
          >
            레시피
          </button>
          <button
            role="tab"
            id="tab-feedback"
            aria-selected={tab === 'feedback'}
            aria-controls="panel-feedback"
            className={tab === 'feedback' ? 'active' : undefined}
            onClick={() => setTab('feedback')}
          >
            피드백
          </button>
        </div>

        {tab === 'timer' &&
          (canUseTimer ? (
            <section
              className="brew-timer"
              role="tabpanel"
              id="panel-timer"
              aria-labelledby="tab-timer"
              aria-label="추출 타이머"
            >
              {currentPhase ? (
                <span className="phase-pill">
                  {phasePill(currentPhase)}
                  {inRest ? ' · 쉬는 중' : ''}
                </span>
              ) : timerDone ? (
                <span className="phase-pill">완료</span>
              ) : null}

              <div className="dial" style={{ '--p': dialProgress } as CSSProperties} role="timer">
                <div className="clock">
                  <div className="time">{formatSeconds(elapsed)}</div>
                  <div className="of">/ {formatSeconds(schedule.totalSec)}</div>
                </div>
              </div>

              <div className="timer-body" aria-live="polite">
                {currentPhase ? (
                  <>
                    <p className="timer-status">
                      {currentPhase.startLabel}–{currentPhase.pourEndLabel} ·{' '}
                      {currentPhase.targetWaterG !== undefined
                        ? `${currentPhase.targetWaterG}g까지`
                        : '목표 무게 미지정'}
                    </p>
                    {inRest ? (
                      <p className="timer-rest">
                        붓기 끝 · {isLast ? '추출 완료까지' : '다음 푸어까지'}{' '}
                        <span className="timer-num">
                          {formatSeconds(currentPhase.endSec - elapsed)}
                        </span>
                      </p>
                    ) : (
                      expectedG !== undefined && (
                        <p className="timer-expected">
                          지금쯤 약 <span className="timer-num">{roundToStep(expectedG)}</span>g
                        </p>
                      )
                    )}
                    {currentPhase.note && <p className="sub">{currentPhase.note}</p>}
                    <div className={`phase-progress${inRest ? ' wait' : ''}`}>
                      <span style={{ width: `${phasePct}%` }} />
                    </div>
                    {nextPhase && !timerDone && (
                      <p className="muted">
                        다음: {nextPhase.startLabel}–{nextPhase.pourEndLabel} ·{' '}
                        {nextPhase.targetWaterG !== undefined
                          ? `${nextPhase.targetWaterG}g까지`
                          : '목표 무게 미지정'}
                      </p>
                    )}
                  </>
                ) : timerDone ? (
                  <p className="timer-status">추출 완료 · 목표 {formatSeconds(schedule.totalSec)}</p>
                ) : null}
              </div>

              <div className="timer-controls">
                {running ? (
                  <button className="t-btn" type="button" onClick={pause}>
                    일시정지
                  </button>
                ) : (
                  <button className="t-btn" type="button" onClick={start}>
                    {elapsed > 0 ? '계속' : '추출 시작'}
                  </button>
                )}
                <button className="t-btn secondary" type="button" onClick={reset}>
                  리셋
                </button>
              </div>
              <label className="sound-toggle">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => onSound(e.target.checked)}
                />
                단계 알림 소리
              </label>
            </section>
          ) : (
            <p className="empty">이 레시피에는 시간이 지정된 푸어가 없어 타이머를 쓸 수 없어요.</p>
          ))}

        {tab === 'recipe' && (
          <div className="stack" role="tabpanel" id="panel-recipe" aria-labelledby="tab-recipe">
            {Object.keys(recipe.params).length > 0 && (
              <section className="stack-tight">
                <h2>파라미터</h2>
                <dl className="dl">
                  {Object.entries(recipe.params).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{paramLabel(k)}</dt>
                      <dd>{k === 'grind' ? grindDisplay(v) : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {grindSpec && (
              <section className="stack-tight">
                <h2>그라인더별 분쇄도</h2>
                <p className="card-meta muted">
                  목표: {grindSpec.target.brewMethodPosition ?? '—'}
                  {grindSpec.target.targetDrawdownSec != null &&
                    ` · 드로다운 ${grindSpec.target.targetDrawdownSec}초`}
                  {grindSpec.target.microns != null && ` · ~${grindSpec.target.microns}µm(참고)`}
                </p>
                {grinders.length > 0 && (
                  <div className="stack-tight">
                    <label className="card-meta">
                      내 그라인더{' '}
                      <select
                        value={selGrinder}
                        onChange={(e) => setSelGrinder(e.target.value)}
                        aria-label="그라인더 선택"
                      >
                        {grinders.map((g) => (
                          <option key={g.name} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {grindSuggestion && (
                      <>
                        <p className="card-title">
                          {grindSuggestion.clicks != null
                            ? `${Math.round(grindSuggestion.clicks)} 클릭${
                                grindSuggestion.range
                                  ? ` (${grindSuggestion.range.from}~${grindSuggestion.range.to})`
                                  : ''
                              }`
                            : (grindSpec.target.brewMethodPosition ?? '환산 정보 없음')}{' '}
                          <span className="muted">
                            {grindSuggestion.basis === 'calibrated'
                              ? '· 내 보정 반영'
                              : grindSuggestion.source === 'measured'
                                ? '· 측정값'
                                : grindSuggestion.source === 'dial-in-start'
                                  ? '· dial-in 시작점'
                                  : ''}
                          </span>
                        </p>
                        {grindSuggestion.disclaimer && (
                          <p className="card-meta muted">{grindSuggestion.disclaimer}</p>
                        )}
                      </>
                    )}
                    {canCalibrate && grindRef && (
                      <div className="row" style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="card-meta muted">내 {selGrinder} 실측 클릭</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={calInput}
                          onChange={(e) => setCalInput(e.target.value)}
                          aria-label="실측 클릭"
                          style={{ width: 72 }}
                        />
                        <button
                          type="button"
                          className="btn-save"
                          disabled={savingCal || calInput.trim() === ''}
                          onClick={() => {
                            const toClicks = Number(calInput);
                            if (grindRefClicks == null || !Number.isFinite(toClicks)) return;
                            setSavingCal(true);
                            upsertCalibration({
                              fromLabel: grindRef.grinder,
                              toLabel: selGrinder,
                              anchorMethod: recipe.method,
                              samples: [{ fromClicks: grindRefClicks, toClicks }],
                              source: 'measured'
                            })
                              .then(() => {
                                setCalInput('');
                                return loadCalibrations();
                              })
                              .catch(() => {
                                /* best-effort */
                              })
                              .finally(() => setSavingCal(false));
                          }}
                        >
                          {savingCal ? '저장 중…' : '보정 저장'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {grindSpec.perGrinder && grindSpec.perGrinder.length > 0 && (
                  <ul className="pour-list">
                    {grindSpec.perGrinder.map((pg, i) => (
                      <li key={`${pg.grinder}-${i}`} className="pour-row">
                        <span>{pg.grinder}</span>
                        <span className="muted">
                          {pg.clicks} 클릭 · {pg.source === 'measured' ? '측정' : 'dial-in'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {dripperLayer && (
              <section className="stack-tight">
                <h2>드리퍼 이식</h2>
                <p className="card-meta muted">
                  원본: {dripperLayer.origin.dripper}
                  {dripperLayer.origin.sizeModel ? ` ${dripperLayer.origin.sizeModel}` : ''}
                  {recipe.params.doseG != null ? ` · ${recipe.params.doseG}g` : ''}
                  {dripperLayer.anchors.ratio ? ` · ${dripperLayer.anchors.ratio}` : ''}
                </p>
                {drippers.length > 0 && (
                  <div className="stack-tight">
                    <label className="card-meta">
                      내 드리퍼{' '}
                      <select
                        value={selDripper}
                        onChange={(e) => setSelDripper(e.target.value)}
                        aria-label="드리퍼 선택"
                      >
                        {drippers.map((d) => (
                          <option key={d.name} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {dripperAdaptation && (
                      <>
                        {dripperAdaptation.bedOverflow && dripperAdaptation.warn && (
                          <p className="error-panel">⚠ {dripperAdaptation.warn}</p>
                        )}
                        <p className="card-title">
                          사이즈 {SIZE_MATCH_LABEL[dripperAdaptation.sizeMatch]} · 분쇄{' '}
                          {GRIND_SHIFT_LABEL[dripperAdaptation.grindShift]} · 푸어{' '}
                          {POUR_SHIFT_LABEL[dripperAdaptation.pourShift]}{' '}
                          <span className="muted">· {CONFIDENCE_LABEL[dripperAdaptation.confidence]}</span>
                        </p>
                        <p className="card-meta muted">{dripperAdaptation.disclaimer}</p>
                      </>
                    )}
                  </div>
                )}
              </section>
            )}
            {brewPhases.length > 0 && (
              <section className="stack-tight">
                <h2>푸어 일정</h2>
                <ul className="pour-list">
                  {brewPhases.map((p) => (
                    <li key={p.index} className={`pour-row ${pourState(p)}`}>
                      <span>{pourLabel(p.index)}</span>
                      <span className="muted">
                        {p.startLabel} – {p.pourEndLabel}
                        {p.pourEndSec < p.endSec && (
                          <span className="detail">
                            쉬기 {p.pourEndLabel} – {p.endLabel}
                          </span>
                        )}
                      </span>
                      <span className="grams">
                        {p.targetWaterG !== undefined ? `${p.targetWaterG} g` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {recipe.steps.length > 0 && (
              <section className="stack-tight">
                <h2>스텝</h2>
                <ol
                  style={{
                    margin: 0,
                    paddingLeft: '1.2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {recipe.steps.map((s, i) => (
                    <li key={i}>{s.note}</li>
                  ))}
                </ol>
              </section>
            )}
            {recipe.notes && (
              <section className="stack-tight">
                <h2>메모</h2>
                <p>{recipe.notes}</p>
              </section>
            )}
          </div>
        )}

        {tab === 'feedback' && (
          <section className="stack" role="tabpanel" id="panel-feedback" aria-labelledby="tab-feedback">
            <FeedbackForm
              recipeCode={recipe.code}
              onCreated={(fb) => setFeedback((f) => [fb, ...f])}
            />
            {feedback.length === 0 ? (
              <p className="empty">아직 피드백이 없어요. 첫 피드백을 남겨보세요.</p>
            ) : (
              feedback.map((fb) => (
                <article key={fb._id} className="card">
                  <p className="card-meta muted">{formatDateTime(fb.createdAt)}</p>
                  {fb.ratings && (
                    <dl className="dl">
                      {Object.entries(fb.ratings).map(([k, v]) => (
                        <div key={k} style={{ display: 'contents' }}>
                          <dt>{ratingLabel(k)}</dt>
                          <dd>{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {fb.quickTags && fb.quickTags.length > 0 && (
                    <div className="chips">
                      {fb.quickTags.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {fb.comment && <p>{fb.comment}</p>}
                  {fb.rawComment && <p>{fb.rawComment}</p>}
                </article>
              ))
            )}
          </section>
        )}
      </div>
    </>
  );
}
