import { useState } from 'react';
import { createFeedback } from '../lib/data/feedback';
import { localizeMessage } from '../lib/labels';
import {
  QUICK_FEEDBACK_TAGS,
  validateCreateFeedbackInput,
  type FeedbackDoc,
  type QuickFeedbackTag,
  type RecipeCode,
} from '../lib/domain';

export default function FeedbackForm({
  recipeCode,
  onCreated,
}: {
  recipeCode: RecipeCode;
  onCreated: (fb: FeedbackDoc) => void;
}) {
  const [overall, setOverall] = useState(0); // 0 = 미선택
  const [tags, setTags] = useState<QuickFeedbackTag[]>([]);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function toggleTag(t: QuickFeedbackTag) {
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  async function submit() {
    setErrors([]);
    const input = {
      recipeCode,
      ...(overall ? { ratings: { overall } } : {}),
      ...(tags.length ? { quickTags: tags } : {}),
      ...(comment.trim() ? { rawComment: comment.trim() } : {}),
      source: 'web' as const,
    };
    const result = validateCreateFeedbackInput(input);
    if (!result.ok) {
      setErrors(result.errors.map(localizeMessage));
      return;
    }
    setBusy(true);
    try {
      const fb = await createFeedback(result.value);
      onCreated(fb);
      setOverall(0);
      setTags([]);
      setComment('');
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="field">
        <label id="overall-label">전체 평가</label>
        <div className="stars" role="radiogroup" aria-labelledby="overall-label">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={overall === n}
              className={`star ${overall >= n ? 'on' : ''}`}
              onClick={() => setOverall(overall === n ? 0 : n)}
              aria-label={`5점 만점에 ${n}점`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>빠른 태그</label>
        <div className="chips">
          {QUICK_FEEDBACK_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip ${tags.includes(t) ? 'active' : ''}`}
              onClick={() => toggleTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="cmt">코멘트</label>
        <textarea
          id="cmt"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="예: 산미가 강했고 단맛은 적당했어요"
        />
      </div>

      {errors.length > 0 && (
        <div className="error-panel">
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <button className="t-btn" type="button" onClick={submit} disabled={busy}>
        {busy ? '저장 중…' : '피드백 남기기'}
      </button>
    </div>
  );
}
