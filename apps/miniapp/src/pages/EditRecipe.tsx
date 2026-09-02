import { Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { getRecipeByCode, updateRecipe } from '../lib/data/recipes';
import { localizeMessage } from '../lib/labels';
import { validateUpdateRecipeInput, type RecipeCode, type RecipeDoc } from '../lib/domain';

type Status = 'loading' | 'ready' | 'error';

export default function EditRecipe({ code }: { code: RecipeCode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [recipe, setRecipe] = useState<RecipeDoc | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getRecipeByCode(code)
      .then((loaded) => {
        if (!alive) return;
        if (!loaded || loaded.ownerId == null) {
          setStatus('error');
          return;
        }
        setRecipe(loaded);
        setTitle(loaded.title);
        setNotes(loaded.notes ?? '');
        setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [code]);

  async function onSubmit() {
    setErrors([]);
    const result = validateUpdateRecipeInput({ title, notes });
    if (!result.ok) {
      setErrors(result.errors.map(localizeMessage));
      return;
    }
    setBusy(true);
    try {
      await updateRecipe(code, result.value);
      location.replace('#/saved');
    } catch (e) {
      setErrors([(e as Error).message]);
      setBusy(false);
    }
  }

  if (status === 'loading') {
    return <div className="screen"><p className="muted">불러오는 중…</p></div>;
  }
  if (status === 'error' || !recipe) {
    return (
      <div className="screen">
        <div className="error-panel">내 레시피를 찾을 수 없어요.</div>
        <button className="t-btn secondary" type="button" onClick={() => location.replace('#/saved')}>
          저장함으로
        </button>
      </div>
    );
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>레시피 수정</Top.TitleParagraph>} />
      <div className="screen">
        <p className="card-meta muted">{recipe.code}</p>
        <div className="field">
          <label htmlFor="edit-title">제목</label>
          <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-notes">메모</label>
          <textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {errors.length > 0 && (
          <div className="error-panel">
            <ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul>
          </div>
        )}
        <div className="timer-controls">
          <button className="t-btn secondary" type="button" onClick={() => location.replace('#/saved')}>
            취소
          </button>
          <button className="t-btn" type="button" onClick={onSubmit} disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </>
  );
}
