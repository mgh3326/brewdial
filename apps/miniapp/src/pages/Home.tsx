import { Button, Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { listRecentRecipes } from '../lib/data/recipes';
import type { RecipeDoc } from '../lib/domain';
import RecipeCard from '../components/RecipeCard';

export default function Home() {
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRecentRecipes(100)
      .then(setRecipes)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={28}>다음 브루를 다이얼인 ☕</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>
            레시피와 추출 타이머, 피드백을 한 곳에서.
          </Top.SubtitleParagraph>
        }
      />
      <div className="screen">
        <div className="row">
          <Button as="a" variant="weak" href="#/recipes/new">
            새 레시피 만들기
          </Button>
        </div>

        {error && <div className="error-panel">불러오기 실패: {error}</div>}

        <section className="stack-tight">
          <h2>레시피{!loading && !error ? ` ${recipes.length}개` : ''}</h2>
          {loading ? (
            <p className="muted">불러오는 중…</p>
          ) : recipes.length === 0 && !error ? (
            <p className="empty">아직 레시피가 없어요. 첫 레시피를 만들어 보세요.</p>
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
