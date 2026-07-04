import { useState } from 'react';
import { TASTE_TAGS } from '../lib/domain';
import type { TasteProfile } from '../lib/data/recommend';
import { updatePreferences } from '../lib/data/recommend';

export default function TasteCard({ profile, onChanged }: { profile: TasteProfile; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [likes, setLikes] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updatePreferences(likes, dislikes);
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  if (profile.confidence === 'none') {
    return (
      <div className="taste-card">
        <p className="muted">원두를 저장하거나 취향을 알려주면 딱 맞는 원두를 표시해요.</p>
        <button className="btn-mini" onClick={() => setEditing(true)}>취향 설정</button>
        {editing && (
          <TagEditor
            likes={likes}
            dislikes={dislikes}
            setLikes={setLikes}
            setDislikes={setDislikes}
            saving={saving}
            onSave={save}
          />
        )}
      </div>
    );
  }

  return (
    <div className="taste-card">
      <div className="label">☕ 당신의 취향</div>
      <div className="taste-summary">{profile.summary}</div>
      {profile.evidence.length > 0 && <div className="muted taste-evidence">{profile.evidence.join(' · ')}</div>}
      {!editing ? (
        <div className="taste-ask">
          이게 맞나요?{' '}
          <button className="btn-mini" onClick={onChanged}>👍</button>
          <button className="btn-mini" onClick={() => setEditing(true)}>✏️ 수정</button>
        </div>
      ) : (
        <TagEditor
          likes={likes}
          dislikes={dislikes}
          setLikes={setLikes}
          setDislikes={setDislikes}
          saving={saving}
          onSave={save}
        />
      )}
    </div>
  );
}

function TagEditor(props: {
  likes: string[];
  dislikes: string[];
  setLikes: (v: string[]) => void;
  setDislikes: (v: string[]) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const toggle = (arr: string[], set: (v: string[]) => void, tag: string) =>
    set(arr.includes(tag) ? arr.filter((t) => t !== tag) : [...arr, tag]);
  return (
    <div className="tag-editor">
      <div className="muted">좋아하는 특성</div>
      <div className="chips">
        {TASTE_TAGS.map((t) => (
          <button
            key={`l-${t}`}
            className={`chip ${props.likes.includes(t) ? 'chip-on' : ''}`}
            onClick={() => toggle(props.likes, props.setLikes, t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="muted">피하고 싶은 특성</div>
      <div className="chips">
        {TASTE_TAGS.map((t) => (
          <button
            key={`d-${t}`}
            className={`chip ${props.dislikes.includes(t) ? 'chip-off' : ''}`}
            onClick={() => toggle(props.dislikes, props.setDislikes, t)}
          >
            {t}
          </button>
        ))}
      </div>
      <button className="btn-mini" disabled={props.saving} onClick={props.onSave}>
        {props.saving ? '저장 중…' : '저장'}
      </button>
    </div>
  );
}
