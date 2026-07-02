import { Top } from '@toss/tds-mobile';
import { useEffect, useMemo, useState } from 'react';
import { createRecipe } from '../lib/data/recipes';
import { listBeans, type BeanSummary } from '../lib/data/beans';
import {
  validateCreateRecipeInput,
  type BrewMethod,
  type CreateRecipeInput,
  type RecipeParams,
  type RecipeStep,
} from '../lib/domain';
import {
  METHOD_LABELS,
  POUR_PRESETS,
  generatePourSteps,
  isPourOverMethod,
  parseRatio,
  suggestTargetTimeSec,
  type PourPreset,
} from '../lib/recipe-presets';
import { GRINDER_PRESETS, loadGear, saveGear } from '../lib/gear-preferences';
import { localizeMessage } from '../lib/labels';

const METHODS: BrewMethod[] = ['v60', 'kalita', 'aeropress', 'espresso', 'other'];

interface StepRow {
  atSec: string;
  waterG: string;
  note: string;
}

const numOrU = (s: string) => (s.trim() === '' ? undefined : Number(s));
const round5 = (n: number) => Math.round(n / 5) * 5;

export default function NewRecipe() {
  const [initialGear] = useState(loadGear);
  const [method, setMethod] = useState<BrewMethod>((initialGear.method as BrewMethod) || 'v60');
  const [grinderChoice, setGrinderChoice] = useState<string>(() => {
    const g = initialGear.grinder;
    if (!g) return '';
    return (GRINDER_PRESETS as readonly string[]).includes(g) ? g : '__custom__';
  });
  const [grinderCustom, setGrinderCustom] = useState<string>(() => {
    const g = initialGear.grinder;
    return g && !(GRINDER_PRESETS as readonly string[]).includes(g) ? g : '';
  });
  const [grind, setGrind] = useState(initialGear.grind ?? '');
  const [beanName, setBeanName] = useState('');
  const [dose, setDose] = useState('20');
  const [ratio, setRatio] = useState('1:16');
  const [waterOverride, setWaterOverride] = useState('');
  const [temp, setTemp] = useState('92');
  const [preset, setPreset] = useState<PourPreset>('even');

  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);

  const [manualSteps, setManualSteps] = useState<StepRow[] | null>(null); // null = 자동 사용

  const [beans, setBeans] = useState<BeanSummary[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmWarn, setConfirmWarn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listBeans()
      .then(setBeans)
      .catch(() => undefined);
  }, []);

  // Clear a pending "경고 무시하고 저장" state when inputs change, so a stale
  // warning can't be silently confirmed on the next click.
  useEffect(() => {
    setConfirmWarn(false);
    setWarnings([]);
  }, [method, dose, ratio, waterOverride, temp, beanName, grind, grinderChoice, grinderCustom, preset, manualSteps]);

  const isPourOver = isPourOverMethod(method);
  const doseNum = numOrU(dose);
  const ratioNum = parseRatio(ratio);
  const effectiveGrinder = (grinderChoice === '__custom__' ? grinderCustom : grinderChoice).trim();
  const computedWater = useMemo(() => {
    const override = numOrU(waterOverride);
    if (override !== undefined && Number.isFinite(override)) return override;
    if (doseNum && ratioNum) return round5(doseNum * ratioNum);
    return undefined;
  }, [waterOverride, doseNum, ratioNum]);

  const autoSteps = useMemo<RecipeStep[]>(() => {
    if (!isPourOver || !doseNum || !computedWater) return [];
    return generatePourSteps(doseNum, computedWater, preset);
  }, [isPourOver, doseNum, computedWater, preset]);

  const manualParsed: RecipeStep[] =
    manualSteps?.filter((s) => s.note.trim()).map((s) => {
      const step: RecipeStep = { note: s.note.trim() };
      const at = Number(s.atSec);
      const water = Number(s.waterG);
      if (s.atSec.trim() && Number.isFinite(at)) step.atSec = at;
      if (s.waterG.trim() && Number.isFinite(water)) step.waterG = water;
      return step;
    }) ?? [];
  const effectiveSteps = manualSteps !== null ? manualParsed : autoSteps;

  const suggestedTitle = `${beanName.trim() ? beanName.trim() + ' · ' : ''}${METHOD_LABELS[method]} ${
    dose || '?'
  }g${ratioNum ? ` 1:${ratioNum}` : ''}${effectiveGrinder ? ` / ${effectiveGrinder}` : ''}`;
  const titleValue = titleEdited ? title : suggestedTitle;

  function openEdit() {
    setManualSteps(
      effectiveSteps.map((s) => ({
        atSec: s.atSec !== undefined ? String(s.atSec) : '',
        waterG: s.waterG !== undefined ? String(s.waterG) : '',
        note: s.note,
      }))
    );
    setConfirmWarn(false);
  }
  function backToAuto() {
    setManualSteps(null);
    setConfirmWarn(false);
  }
  function setStep(i: number, patch: Partial<StepRow>) {
    setManualSteps((s) => (s ? s.map((row, j) => (j === i ? { ...row, ...patch } : row)) : s));
    setConfirmWarn(false);
  }
  function addStep() {
    setManualSteps((s) => [...(s ?? []), { atSec: '', waterG: '', note: '' }]);
  }
  function removeStep(i: number) {
    setManualSteps((s) => (s ? s.filter((_, j) => j !== i) : s));
  }

  function buildInput(): CreateRecipeInput {
    const params: RecipeParams = {};
    if (doseNum !== undefined) params.doseG = doseNum;
    if (computedWater !== undefined) params.waterG = computedWater;
    if (numOrU(temp) !== undefined) params.tempC = numOrU(temp);
    if (ratioNum) params.ratio = `1:${ratioNum}`;
    if (effectiveGrinder) params.grinder = effectiveGrinder;
    if (grind.trim()) params.grind = grind.trim();
    const tts = suggestTargetTimeSec(effectiveSteps);
    if (tts !== undefined) params.targetTimeSec = tts;

    const input: CreateRecipeInput = {
      method,
      title: titleValue.trim(),
      params,
      steps: effectiveSteps,
      createdBy: 'manual',
    };
    if (beanName.trim()) {
      // Map onto an existing bean (carry its roaster) so the DB trigger groups
      // it under the same bean instead of creating a near-duplicate.
      const matched = beans.find(
        (b) => b.name.trim().toLowerCase() === beanName.trim().toLowerCase()
      );
      input.beanSnapshot = matched
        ? { name: matched.name, ...(matched.roaster ? { roaster: matched.roaster } : {}) }
        : { name: beanName.trim() };
    }
    return input;
  }

  async function onSubmit() {
    setErrors([]);
    const result = validateCreateRecipeInput(buildInput());
    if (!result.ok) {
      setErrors(result.errors.map(localizeMessage));
      setWarnings([]);
      setConfirmWarn(false);
      return;
    }
    if (result.warnings.length > 0 && !confirmWarn) {
      setWarnings(result.warnings.map(localizeMessage));
      setConfirmWarn(true);
      return;
    }
    setBusy(true);
    try {
      const created = await createRecipe(result.value);
      saveGear({
        method,
        grinder: effectiveGrinder || undefined,
        grind: grind.trim() || undefined,
      });
      // ROB-635: replace → back terminates the mini-app (no empty form re-entry).
      location.replace(`#/recipes/${created.code}`);
    } catch (e) {
      setErrors([(e as Error).message]);
      setBusy(false);
    }
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>새 레시피</Top.TitleParagraph>} />
      <div className="screen">
        <div className="field">
          <label htmlFor="method">드리퍼 / 기구</label>
          <select
            id="method"
            value={method}
            onChange={(e) => setMethod(e.target.value as BrewMethod)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="grinder">그라인더</label>
          <select
            id="grinder"
            value={grinderChoice}
            onChange={(e) => setGrinderChoice(e.target.value)}
          >
            <option value="">선택 안 함</option>
            {GRINDER_PRESETS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            <option value="__custom__">기타 (직접 입력)</option>
          </select>
        </div>
        {grinderChoice === '__custom__' && (
          <div className="field">
            <label htmlFor="grinderCustom">그라인더 이름</label>
            <input
              id="grinderCustom"
              value={grinderCustom}
              onChange={(e) => setGrinderCustom(e.target.value)}
              placeholder="예: Comandante C40"
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="grind">분쇄도 (선택)</label>
          <input
            id="grind"
            value={grind}
            onChange={(e) => setGrind(e.target.value)}
            placeholder="예: 108클릭 / Medium"
          />
        </div>

        <div className="field">
          <label htmlFor="bean">원두 이름 (선택)</label>
          <input
            id="bean"
            list="bean-options"
            value={beanName}
            onChange={(e) => setBeanName(e.target.value)}
            placeholder="예: 에티오피아 예가체프"
          />
          <datalist id="bean-options">
            {beans.map((b) => (
              <option key={b.id} value={b.name} />
            ))}
          </datalist>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="dose">원두(g)</label>
            <input id="dose" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ratio">비율</label>
            <input id="ratio" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="1:16" />
          </div>
          <div className="field">
            <label htmlFor="temp">온도(℃)</label>
            <input id="temp" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="water">물(g)</label>
          <input
            id="water"
            inputMode="decimal"
            value={waterOverride}
            onChange={(e) => setWaterOverride(e.target.value)}
            placeholder={computedWater !== undefined ? `${computedWater} (자동)` : '원두·비율로 자동 계산'}
          />
        </div>

        {isPourOver && (
          <div className="field">
            <label htmlFor="preset">푸어 스타일</label>
            <select
              id="preset"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as PourPreset);
                if (manualSteps !== null) backToAuto();
              }}
              disabled={manualSteps !== null}
            >
              {POUR_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <section className="stack-tight">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>푸어 일정</h2>
            {effectiveSteps.length > 0 &&
              (manualSteps !== null ? (
                <button className="link-btn" type="button" onClick={backToAuto}>
                  자동으로 되돌리기
                </button>
              ) : (
                <button className="link-btn" type="button" onClick={openEdit}>
                  직접 편집
                </button>
              ))}
          </div>

          {!isPourOver && manualSteps === null && (
            <p className="sub">이 기구는 자동 푸어가 없어요. ‘직접 편집’으로 스텝을 추가할 수 있어요.</p>
          )}

          {manualSteps === null ? (
            effectiveSteps.length === 0 ? (
              <p className="sub">
                {isPourOver ? '원두량과 비율을 넣으면 푸어 일정이 자동으로 만들어져요.' : ''}
              </p>
            ) : (
              <ul className="pour-list">
                {effectiveSteps.map((s, i) => (
                  <li key={i} className="pour-row">
                    <span>{i === 0 ? 'Bloom' : `Pour ${i}`}</span>
                    <span className="muted">{s.atSec !== undefined ? `${s.atSec}s` : ''}</span>
                    <span className="grams">{s.waterG !== undefined ? `${s.waterG} g` : '—'}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <>
              {(manualSteps ?? []).map((s, i) => (
                <div key={i} className="step-row">
                  <input
                    inputMode="numeric"
                    value={s.atSec}
                    onChange={(e) => setStep(i, { atSec: e.target.value })}
                    placeholder="시간(초)"
                    aria-label={`스텝 ${i + 1} 시간`}
                  />
                  <input
                    inputMode="decimal"
                    value={s.waterG}
                    onChange={(e) => setStep(i, { waterG: e.target.value })}
                    placeholder="누적 물(g)"
                    aria-label={`스텝 ${i + 1} 물`}
                  />
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => removeStep(i)}
                    aria-label={`스텝 ${i + 1} 삭제`}
                  >
                    삭제
                  </button>
                  <input
                    className="note"
                    value={s.note}
                    onChange={(e) => setStep(i, { note: e.target.value })}
                    placeholder="메모 (예: 뜸들이기 / 1차 푸어)"
                    aria-label={`스텝 ${i + 1} 메모`}
                  />
                </div>
              ))}
              <button className="link-btn" type="button" onClick={addStep}>
                + 스텝 추가
              </button>
            </>
          )}
        </section>

        <div className="field">
          <label htmlFor="title">제목</label>
          <input
            id="title"
            value={titleValue}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleEdited(true);
            }}
            placeholder="제목"
          />
        </div>

        {errors.length > 0 && (
          <div className="error-panel">
            저장할 수 없어요.
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {confirmWarn && warnings.length > 0 && (
          <div className="warn-panel">
            아래는 경고예요. 그대로 저장하려면 다시 한번 눌러주세요.
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="timer-controls">
          <button
            className="t-btn secondary"
            type="button"
            // ROB-635: pop the form entry → back terminates, not re-enters the form.
            onClick={() => {
              if (history.length > 1) history.back();
              else location.replace('#/');
            }}
          >
            취소
          </button>
          <button className="t-btn" type="button" onClick={onSubmit} disabled={busy}>
            {busy ? '저장 중…' : confirmWarn ? '경고 무시하고 저장' : '저장'}
          </button>
        </div>
      </div>
    </>
  );
}
