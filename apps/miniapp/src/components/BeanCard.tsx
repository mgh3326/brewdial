import type { BeanSummary } from '../lib/data/beans';

export default function BeanCard({ bean }: { bean: BeanSummary }) {
  const meta = [bean.roaster, bean.origin, bean.process, bean.roastLevel].filter(Boolean).join(' · ');
  return (
    <a className="card" href={`#/beans/${encodeURIComponent(bean.id)}`}>
      <p className="card-title">
        {bean.name}
        {bean.hasAi && <span className="badge-ai" style={{ marginLeft: 6 }}>✨ AI</span>}
      </p>
      {meta && <p className="card-meta muted">{meta}</p>}
      <p className="card-meta muted">레시피 {bean.recipeCount}개</p>
    </a>
  );
}
