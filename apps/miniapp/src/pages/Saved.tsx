import { ConfirmDialog, Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import type { BeanSummary } from '../lib/data/beans';
import { listBeans } from '../lib/data/beans';
import { getMyCollections } from '../lib/data/user-content';
import type { RecipeDoc } from '../lib/domain';
import { asRecipeCode } from '../lib/nav';
import { deleteRecipe, getRecipeByCode } from '../lib/data/recipes';
import BeanCard from '../components/BeanCard';
import RecipeCard from '../components/RecipeCard';

interface SavedRecipeRow {
  recipe_code?: string;
}

interface SavedBeanRow {
  bean_id?: string;
}

type Status = 'loading' | 'ready' | 'error';

function OwnedRecipeItem({ recipe, onDeleted }: { recipe: RecipeDoc; onDeleted: (code: string) => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);
    setBusy(true);
    try {
      await deleteRecipe(recipe.code);
      setDialogOpen(false);
      onDeleted(recipe.code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-tight">
      <RecipeCard recipe={recipe} mine />
      <div className="row">
        <a className="btn-save" href={`#/recipes/${recipe.code}/edit`}>수정</a>
        <button className="btn-save danger" type="button" onClick={() => setDialogOpen(true)} disabled={busy}>
          삭제
        </button>
      </div>
      {error && <p className="error-panel">{error}</p>}
      <ConfirmDialog
        open={dialogOpen}
        title="레시피를 삭제할까요?"
        description="삭제하면 저장함의 내 레시피에서 숨겨져요."
        closeOnDimmerClick={!busy}
        closeOnBackEvent={!busy}
        onClose={() => {
          if (!busy) setDialogOpen(false);
        }}
        cancelButton={
          <ConfirmDialog.CancelButton type="button" onClick={() => setDialogOpen(false)} disabled={busy}>
            취소
          </ConfirmDialog.CancelButton>
        }
        confirmButton={
          <ConfirmDialog.ConfirmButton type="button" onClick={() => void confirmDelete()} disabled={busy}>
            {busy ? '삭제 중…' : '삭제'}
          </ConfirmDialog.ConfirmButton>
        }
      />
    </div>
  );
}

export default function Saved() {
  const [status, setStatus] = useState<Status>('loading');
  const [savedBeans, setSavedBeans] = useState<BeanSummary[]>([]);
  const [savedRecipes, setSavedRecipes] = useState<RecipeDoc[]>([]);
  const [myRecipes, setMyRecipes] = useState<RecipeDoc[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [mc, allBeans] = await Promise.all([
          getMyCollections(),
          listBeans(),
        ]);

        const savedBeanIds = new Set(
          (mc.savedBeans as SavedBeanRow[])
            .map((s) => s.bean_id)
            .filter((x): x is string => Boolean(x)),
        );
        const resolvedBeans = allBeans.filter((b) => savedBeanIds.has(b.id));

        const savedCodes = (mc.savedRecipes as SavedRecipeRow[])
          .map((s) => s.recipe_code)
          .filter((x): x is string => Boolean(x))
          .map(asRecipeCode)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const ownedCodes = mc.myRecipes
          .map(asRecipeCode)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        // Tolerate 404s — a bookmarked/owned recipe may have been deleted.
        const [savedDocs, myDocs] = await Promise.all([
          Promise.all(savedCodes.map((c) => getRecipeByCode(c))).then((xs) =>
            xs.filter((x): x is RecipeDoc => x !== null),
          ),
          Promise.all(ownedCodes.map((c) => getRecipeByCode(c))).then((xs) =>
            xs.filter((x): x is RecipeDoc => x !== null),
          ),
        ]);

        if (cancelled) return;
        setSavedBeans(resolvedBeans);
        setSavedRecipes(savedDocs);
        setMyRecipes(myDocs);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Top title={<Top.TitleParagraph size={28}>저장함</Top.TitleParagraph>} />
      <div className="screen screen-tabpage">
        {status === 'loading' && <p className="muted">불러오는 중…</p>}

        {status === 'error' && (
          <p className="empty">로그인 정보가 없어 저장함을 불러올 수 없어요.</p>
        )}

        {status === 'ready' && (
          <>
            <section className="stack-tight">
              <h2>저장한 원두 {savedBeans.length > 0 ? `${savedBeans.length}종` : ''}</h2>
              {savedBeans.length === 0 ? (
                <p className="empty">아직 저장한 원두가 없어요.</p>
              ) : (
                <div className="stack">
                  {savedBeans.map((b) => (
                    <BeanCard key={`sb-${b.id}`} bean={b} />
                  ))}
                </div>
              )}
            </section>

            <section className="stack-tight">
              <h2>저장한 레시피 {savedRecipes.length > 0 ? savedRecipes.length : ''}</h2>
              {savedRecipes.length === 0 ? (
                <p className="empty">저장한 레시피가 없어요. 레시피에서 저장을 눌러보세요.</p>
              ) : (
                <div className="stack">
                  {savedRecipes.map((r) => (
                    <RecipeCard key={`sr-${r.code}`} recipe={r} />
                  ))}
                </div>
              )}
            </section>

            <section className="stack-tight">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>내 레시피 {myRecipes.length > 0 ? myRecipes.length : ''}</h2>
                <a className="btn-save" href="#/new-recipe">새 레시피</a>
              </div>
              {myRecipes.length === 0 ? (
                <p className="empty">내 레시피가 없어요. 새 레시피를 만들어보세요.</p>
              ) : (
                <div className="stack">
                  {myRecipes.map((r) => (
                    <OwnedRecipeItem
                      key={`mr-${r.code}`}
                      recipe={r}
                      onDeleted={(code) => setMyRecipes((current) => current.filter((item) => item.code !== code))}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
