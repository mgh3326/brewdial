import type { BeanSummary } from '../lib/data/beans';
import type { MatchBand } from '../lib/data/recommend';

const BAND_LABEL: Record<MatchBand, string> = {
  great: '잘 맞음',
  ok: '무난',
  adventure: '모험',
  unknown: '정보 없음',
};

export default function BeanCard({ bean, band }: { bean: BeanSummary; band?: MatchBand }) {
  const meta = [bean.roaster, bean.origin, bean.process, bean.roastLevel].filter(Boolean).join(' · ');
  return (
    <a className="card" href={`#/beans/${encodeURIComponent(bean.id)}`}>
      <p className="card-title">
        {bean.name}
        {bean.hasAi && <span className="badge-ai" style={{ marginLeft: 6 }}>✨ AI</span>}
        {band && band !== 'unknown' && <span className={`band band-${band}`} style={{ marginLeft: 6 }}>{BAND_LABEL[band]}</span>}
      </p>
      {meta && <p className="card-meta muted">{meta}</p>}
      <p className="card-meta muted">레시피 {bean.recipeCount}개</p>
    </a>
  );
}
