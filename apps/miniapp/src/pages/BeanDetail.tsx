import { Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { getBean, type BeanSummary } from '../lib/data/beans';
import { listRecipesByBean } from '../lib/data/recipes';
import RecipeCard from '../components/RecipeCard';
import type { RecipeDoc } from '../lib/domain';

export default function BeanDetail({ id }: { id: string }) {
  const [bean, setBean] = useState<BeanSummary | null>(null);
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>{bean.name}</Top.TitleParagraph>}
        subtitleBottom={meta ? <Top.SubtitleParagraph size={13}>{meta}</Top.SubtitleParagraph> : undefined}
      />
      <div className="screen">
        {bean.notes && <p className="sub">{bean.notes}</p>}
        <section className="stack-tight">
          <h2>레시피 {recipes.length}개</h2>
          {recipes.length === 0 ? (
            <p className="empty">이 원두의 레시피가 아직 없어요.</p>
          ) : (
            <div className="stack">
              {recipes.map((r) => (
                <RecipeCard key={r._id} recipe={r} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
