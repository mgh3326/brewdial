import { Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { getBean, type BeanSummary } from '../lib/data/beans';
import { listRecipesByBean } from '../lib/data/recipes';
import { getMyCollections, saveBean } from '../lib/data/user-content';
import RecipeCard from '../components/RecipeCard';
import type { RecipeDoc } from '../lib/domain';

type RecipeFilter = 'all' | 'official' | 'community' | 'mine';
const FILTERS: ReadonlyArray<[RecipeFilter, string]> = [
  ['all', '전체'],
  ['official', '공식'],
  ['community', '커뮤니티'],
  ['mine', '내 레시피'],
];

export default function BeanDetail({ id }: { id: string }) {
  const [bean, setBean] = useState<BeanSummary | null>(null);
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecipeFilter>('all');
  const [myCodes, setMyCodes] = useState<Set<string>>(new Set());
  const [beanSaved, setBeanSaved] = useState(false);
  const [savingBean, setSavingBean] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [b, rs] = await Promise.all([getBean(id), listRecipesByBean(id)]);
        if (!b) setError('원두를 찾을 수 없어요.');
        setBean(b);
        setRecipes(rs);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Per-user collections (best-effort): which recipes are mine, is this bean saved.
  useEffect(() => {
    void (async () => {
      try {
        const mc = await getMyCollections();
        setMyCodes(new Set(mc.myRecipes));
        const savedIds = new Set(
          (mc.savedBeans as Array<{ bean_id?: string }>)
            .map((s) => s.bean_id)
            .filter((x): x is string => Boolean(x))
        );
        setBeanSaved(savedIds.has(id));
      } catch {
        // collections unavailable (no identity / offline) — leave defaults.
      }
    })();
  }, [id]);

  function handleSaveBean(): void {
    if (savingBean || beanSaved) return;
    setSavingBean(true);
    saveBean(id)
      .then(() => setBeanSaved(true))
      .catch(() => {
        /* best-effort */
      })
      .finally(() => setSavingBean(false));
  }

  if (loading) {
    return (
      <div className="screen">
        <p className="muted">불러오는 중…</p>
      </div>
    );
  }
  if (error || !bean) {
    return (
      <div className="screen">
        <div className="error-panel">{error ?? '원두를 찾을 수 없어요.'}</div>
        <a className="card" href="#/">
          원두 목록으로
        </a>
      </div>
    );
  }

  const meta = [bean.roaster, bean.origin, bean.process, bean.roastLevel].filter(Boolean).join(' · ');
  const shown = recipes.filter((r) => {
    if (filter === 'official') return r.isOfficial;
    if (filter === 'community') return !r.isOfficial;
    if (filter === 'mine') return myCodes.has(r.code);
    return true;
  });
  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>{bean.name}</Top.TitleParagraph>}
        subtitleBottom={meta ? <Top.SubtitleParagraph size={13}>{meta}</Top.SubtitleParagraph> : undefined}
      />
      <div className="screen">
        {bean.notes && <p className="sub">{bean.notes}</p>}

        <div className="row">
          <button
            type="button"
            className={`btn-save${beanSaved ? ' saved' : ''}`}
            disabled={savingBean || beanSaved}
            onClick={handleSaveBean}
          >
            {beanSaved ? '원두 저장됨 ✓' : savingBean ? '저장 중…' : '원두 저장'}
          </button>
        </div>

        <section className="stack-tight">
          <h2>레시피 {recipes.length}개</h2>
          <div className="filter-row" role="tablist" aria-label="레시피 필터">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? 'active' : undefined}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="empty">
              {filter === 'mine' ? '내 레시피가 아직 없어요.' : '이 원두의 레시피가 아직 없어요.'}
            </p>
          ) : (
            <div className="stack">
              {shown.map((r) => (
                <RecipeCard key={r._id} recipe={r} mine={myCodes.has(r.code)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
