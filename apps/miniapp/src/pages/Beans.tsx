import { Button, Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { listBeans, type BeanSummary } from '../lib/data/beans';
import BeanCard from '../components/BeanCard';

export default function Beans() {
  const [beans, setBeans] = useState<BeanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBeans()
      .then(setBeans)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={28}>원두로 찾는 레시피 ☕</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>원두를 고르면 그 원두의 레시피가 나와요.</Top.SubtitleParagraph>
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
          <h2>원두{!loading && !error ? ` ${beans.length}종` : ''}</h2>
          {loading ? (
            <p className="muted">불러오는 중…</p>
          ) : beans.length === 0 && !error ? (
            <p className="empty">아직 원두가 없어요. 새 레시피를 만들면 원두가 자동으로 묶여요.</p>
          ) : (
            <div className="stack">
              {beans.map((b) => (
                <BeanCard key={b.id} bean={b} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
