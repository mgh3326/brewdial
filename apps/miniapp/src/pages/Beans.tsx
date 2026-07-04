import { Button, Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { listBeans, type BeanSummary } from '../lib/data/beans';
import { getMyCollections } from '../lib/data/user-content';
import { fetchRecommendations, type RecommendationsResponse } from '../lib/data/recommend';
import BeanCard from '../components/BeanCard';
import TasteCard from '../components/TasteCard';

export default function Beans() {
  const [beans, setBeans] = useState<BeanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null);

  useEffect(() => {
    listBeans()
      .then(setBeans)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Per-user saved beans (best-effort): shown as a section above the full list.
  useEffect(() => {
    void (async () => {
      try {
        const mc = await getMyCollections();
        setSavedIds(
          new Set(
            (mc.savedBeans as Array<{ bean_id?: string }>)
              .map((s) => s.bean_id)
              .filter((x): x is string => Boolean(x))
          )
        );
      } catch {
        // collections unavailable — no saved section.
      }
    })();
  }, []);

  // ROB-654 v2 S1: read-time taste target + per-bean match bands.
  useEffect(() => {
    fetchRecommendations().then(setRecs).catch(() => { /* 추천 없으면 배지 생략 */ });
  }, []);

  const savedBeans = beans.filter((b) => savedIds.has(b.id));

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={28}>원두로 찾는 레시피 ☕</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>원두를 고르면 그 원두의 레시피가 나와요.</Top.SubtitleParagraph>
        }
      />
      <div className="screen screen-tabpage">
        <div className="row">
          <Button as="a" variant="weak" href="#/recipes/new">
            새 레시피 만들기
          </Button>
        </div>

        {error && <div className="error-panel">불러오기 실패: {error}</div>}

        {recs && (
          <TasteCard
            profile={recs.tasteProfile}
            onChanged={() => fetchRecommendations().then(setRecs).catch(() => {})}
          />
        )}

        {savedBeans.length > 0 && (
          <section className="stack-tight">
            <h2>저장한 원두 {savedBeans.length}종</h2>
            <div className="stack">
              {savedBeans.map((b) => (
                <BeanCard key={`saved-${b.id}`} bean={b} band={recs?.bands[b.id]?.band} />
              ))}
            </div>
          </section>
        )}

        <section className="stack-tight">
          <h2>원두{!loading && !error ? ` ${beans.length}종` : ''}</h2>
          {loading ? (
            <p className="muted">불러오는 중…</p>
          ) : beans.length === 0 && !error ? (
            <p className="empty">아직 원두가 없어요. 새 레시피를 만들면 원두가 자동으로 묶여요.</p>
          ) : (
            <div className="stack">
              {beans.map((b) => (
                <BeanCard key={b.id} bean={b} band={recs?.bands[b.id]?.band} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
