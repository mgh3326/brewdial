import type { TasteProfile } from '../lib/data/recommend';

// Recommendations remain visible in the miniapp, but global preference edits
// are agent-only and therefore have no visitor-facing editor here.
export default function TasteCard({ profile }: { profile: TasteProfile }) {
  return (
    <div className="taste-card">
      <div className="label">☕ 당신의 취향</div>
      {profile.confidence === 'none' ? (
        <p className="muted">원두를 저장하거나 MCP에서 취향을 설정하면 딱 맞는 원두를 표시해요.</p>
      ) : (
        <>
          <div className="taste-summary">{profile.summary}</div>
          {profile.evidence.length > 0 && <div className="muted taste-evidence">{profile.evidence.join(' · ')}</div>}
        </>
      )}
    </div>
  );
}
