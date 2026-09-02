import { Top } from '@toss/tds-mobile';
import FeedbackForm from '../components/FeedbackForm';
import type { RecipeCode } from '../lib/domain';

export default function RecipeFeedback({ code }: { code: RecipeCode }) {
  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>피드백 남기기</Top.TitleParagraph>} />
      <div className="screen">
        <p className="card-meta muted">레시피 {code}</p>
        <FeedbackForm
          recipeCode={code}
          onCreated={() => {
            location.replace(`#/recipes/${code}`);
          }}
        />
        <button
          className="t-btn secondary"
          type="button"
          onClick={() => location.replace(`#/recipes/${code}`)}
        >
          취소
        </button>
      </div>
    </>
  );
}
