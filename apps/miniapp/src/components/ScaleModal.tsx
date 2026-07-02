import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecipeDoc } from '../lib/domain';
import { createRecipe } from '../lib/data/recipes';
import { scaleRecipe } from '../lib/recipe-scale';
import { grindDisplay } from '../lib/domain';

interface ScaleModalProps {
  recipe: RecipeDoc;
  onClose: () => void;
  onSaved: (newCode: string) => void;
}

export default function ScaleModal({ recipe, onClose, onSaved }: ScaleModalProps) {
  const oldDose = recipe.params.doseG;
  const [doseText, setDoseText] = useState<string>(oldDose !== undefined ? String(oldDose) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const newDose = Number(doseText);
  const doseValid = Number.isFinite(newDose) && newDose > 0;
  const noOp = doseValid && oldDose !== undefined && Math.abs(newDose - oldDose) < 1e-9;

  const preview = useMemo(() => {
    if (!doseValid || oldDose === undefined) return null;
    try {
      return scaleRecipe(recipe, newDose);
    } catch {
      return null;
    }
  }, [recipe, newDose, doseValid, oldDose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, busy]);

  async function onSave() {
    if (!preview || busy || noOp) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createRecipe(preview);
      onSaved(created.code);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const params = preview?.params;
  const steps = preview?.steps ?? [];

  return (
    <div
      className="scale-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scale-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="scale-sheet">
        <div className="scale-handle" aria-hidden="true" />
        <h2 id="scale-title" className="scale-title">다른 용량으로 만들기</h2>
        <p className="scale-sub muted">
          도즈를 바꾸면 물량·푸어가 같은 비율로 다시 계산돼요. 시간·온도·분쇄도는 그대로예요.
        </p>

        <div className="field">
          <label htmlFor="scale-dose">새 도즈 (g)</label>
          <input
            id="scale-dose"
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={1}
            step={0.5}
            value={doseText}
            onChange={(e) => setDoseText(e.target.value)}
            disabled={busy}
          />
        </div>

        {preview && (
          <div className="scale-preview">
            <dl className="dl">
              <dt>원두</dt>
              <dd>
                <span className="scale-changed">{params?.doseG}g</span>
                {oldDose !== undefined && (
                  <span className="muted"> ({oldDose}g에서)</span>
                )}
              </dd>
              {params?.waterG !== undefined && (
                <>
                  <dt>총 물</dt>
                  <dd>
                    <span className="scale-changed">{params.waterG}g</span>
                  </dd>
                </>
              )}
              {params?.ratio !== undefined && (
                <>
                  <dt>비율</dt>
                  <dd className="muted">{params.ratio} (그대로)</dd>
                </>
              )}
              {params?.tempC !== undefined && (
                <>
                  <dt>온도</dt>
                  <dd className="muted">{params.tempC}℃ (그대로)</dd>
                </>
              )}
              {params?.grind !== undefined && (
                <>
                  <dt>분쇄도</dt>
                  <dd className="muted">{grindDisplay(params.grind)} (그대로)</dd>
                </>
              )}
            </dl>

            {steps.some((s) => s.waterG !== undefined) && (
              <>
                <p className="scale-sec-title">푸어 (누적 물)</p>
                <ul className="pour-list">
                  {steps.map((s, i) => (
                    <li key={i} className="pour-row">
                      <span>{i === 0 ? 'Bloom' : `Pour ${i}`}</span>
                      <span className="muted">{s.atSec !== undefined ? `${s.atSec}s` : '—'}</span>
                      <span className="grams scale-changed">
                        {s.waterG !== undefined ? `${s.waterG} g` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {error && <div className="error-panel">{error}</div>}

        <div className="timer-controls">
          <button
            className="t-btn secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            취소
          </button>
          <button
            className="t-btn"
            type="button"
            onClick={onSave}
            disabled={busy || !preview || noOp}
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
