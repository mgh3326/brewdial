import { Top } from '@toss/tds-mobile';
import { useEffect, useState } from 'react';
import { fetchPick, type PickAnswers, type PickResponse } from '../lib/data/pick';

const STORAGE_KEY = 'brewdial.pick.answers';
const DEFAULT_ANSWERS: PickAnswers = { acidity: 3, body: 3, roast: 3, decaf: false };

const BAND_LABEL: Record<string, string> = {
  great: '취향에 딱 맞아요',
  ok: '오늘 잘 어울려요',
  adventure: '새로운 한 잔이에요',
  unknown: '한번 골라봤어요',
};

function readSavedAnswers(): PickAnswers | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PickAnswers>;
    if (
      (parsed.acidity !== 1 && parsed.acidity !== 3 && parsed.acidity !== 5)
      || (parsed.body !== 1 && parsed.body !== 3 && parsed.body !== 5)
      || (parsed.roast !== 1 && parsed.roast !== 3 && parsed.roast !== 5)
      || typeof parsed.decaf !== 'boolean'
    ) return null;
    return parsed as PickAnswers;
  } catch {
    return null;
  }
}

function saveAnswers(answers: PickAnswers): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    // Storage can be unavailable in private WebViews; the in-memory flow still works.
  }
}

function newSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

function ChoiceRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: 1 | 3 | 5;
  onChange: (value: 1 | 3 | 5) => void;
  options: ReadonlyArray<{ value: 1 | 3 | 5; label: string }>;
}) {
  return (
    <section className="pick-question" aria-label={label}>
      <h2>{label}</h2>
      <div className="filter-row" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? 'active' : ''}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Pick() {
  const [saved] = useState<PickAnswers | null>(() => readSavedAnswers());
  const [answers, setAnswers] = useState<PickAnswers>(saved ?? DEFAULT_ANSWERS);
  const [showQuiz, setShowQuiz] = useState(!saved);
  const [result, setResult] = useState<PickResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draw(nextAnswers: PickAnswers): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchPick(nextAnswers, newSeed()));
    } catch (err) {
      setResult(null);
      setError((err as Error).message || '커피를 고르지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  // Returning visitors skip questions and receive a fresh, current pick.
  useEffect(() => {
    if (saved) void draw(saved);
    // `saved` is intentionally captured once: only a revisit should auto-draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(): void {
    saveAnswers(answers);
    setShowQuiz(false);
    void draw(answers);
  }

  function chooseAgain(): void {
    setResult(null);
    setError(null);
    setShowQuiz(true);
  }

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={28}>오늘의 커피 뽑기 ☕</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>세 가지만 고르면 오늘 마실 한 잔을 골라드려요.</Top.SubtitleParagraph>
        }
      />
      <main className="screen screen-tabpage">
        {showQuiz ? (
          <section className="card pick-form">
            <ChoiceRow
              label="산미는 어떤가요?"
              value={answers.acidity}
              onChange={(acidity) => setAnswers((current) => ({ ...current, acidity }))}
              options={[{ value: 1, label: '낮게' }, { value: 3, label: '중간' }, { value: 5, label: '높게' }]}
            />
            <ChoiceRow
              label="무게감은 어떤가요?"
              value={answers.body}
              onChange={(body) => setAnswers((current) => ({ ...current, body }))}
              options={[{ value: 1, label: '가볍게' }, { value: 3, label: '중간' }, { value: 5, label: '묵직하게' }]}
            />
            <ChoiceRow
              label="로스팅은 어떤가요?"
              value={answers.roast}
              onChange={(roast) => setAnswers((current) => ({ ...current, roast }))}
              options={[{ value: 1, label: '라이트' }, { value: 3, label: '미디엄' }, { value: 5, label: '다크' }]}
            />
            <label className="pick-decaf">
              <input
                type="checkbox"
                checked={answers.decaf}
                onChange={(event) => setAnswers((current) => ({ ...current, decaf: event.target.checked }))}
              />
              오늘은 디카페인으로 고를게요
            </label>
            <button className="pick-primary" type="button" onClick={submit}>뽑기</button>
          </section>
        ) : (
          <section className="stack" aria-live="polite">
            {loading && <div className="card pick-status"><p className="muted">오늘의 커피를 고르는 중이에요…</p></div>}
            {error && (
              <div className="error-panel">
                <p>뽑기에 실패했어요. {error}</p>
                <button className="btn-mini" type="button" onClick={() => void draw(answers)}>다시 시도</button>
              </div>
            )}
            {!loading && !error && result?.bean === null && (
              <div className="card pick-status">
                <h2>아직 고를 수 있는 원두가 없어요</h2>
                <p className="muted">원두 정보가 조금 더 쌓이면 오늘의 커피를 바로 골라드릴게요.</p>
                <button className="btn-mini" type="button" onClick={chooseAgain}>취향 다시 고르기</button>
              </div>
            )}
            {!loading && !error && result?.bean && (
              <article className="card pick-result">
                <p className={`band band-${result.band ?? 'unknown'}`}>{BAND_LABEL[result.band ?? 'unknown']}</p>
                <h2 className="pick-bean-name">{result.bean.name ?? '이름 없는 원두'}</h2>
                <p className="muted">{result.why ?? '오늘의 취향을 바탕으로 골랐어요.'}</p>
                {result.recipe && (
                  <div className="pick-recipe">
                    <p className="sub">추천 레시피</p>
                    <p className="card-title">
                      {result.recipe.title}
                      {result.recipe.createdBy === 'agent' && <span className="badge-ai">✨ AI 생성</span>}
                    </p>
                    <a className="pick-primary pick-link" href={`#/recipes/${result.recipe.code}`}>이 레시피로 타이머 시작</a>
                  </div>
                )}
                <div className="row pick-actions">
                  <button className="btn-mini" type="button" onClick={() => void draw(answers)}>다시 뽑기</button>
                  <button className="pick-text-button" type="button" onClick={chooseAgain}>취향 다시 고르기</button>
                </div>
              </article>
            )}
          </section>
        )}
      </main>
    </>
  );
}
