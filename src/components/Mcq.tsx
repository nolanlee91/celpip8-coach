import { Icon } from "./Icon";
import type { McqQuestion } from "../../shared/types";
import { CATEGORIES, TRAPS, type Skill } from "../../shared/spec";
import { useTutor } from "./Tutor";
import { Badge } from "./ui";

const LETTERS = ["A", "B", "C", "D", "E"];

export function McqList({
  questions, answers, onAnswer, reviewed, skill, onEvidence, exerciseTitle, disabled,
}: {
  questions: McqQuestion[];
  answers: Record<string, number | null>;
  onAnswer: (qid: string, idx: number) => void;
  reviewed: boolean;
  skill: Skill;
  onEvidence?: (quote: string) => void;
  exerciseTitle: string;
  disabled?: boolean;
}) {
  const tutor = useTutor();
  return (
    <div className="mcq-list">
      {questions.map((q) => {
        const chosen = answers[q.id] ?? null;
        const correct = reviewed && chosen === q.answerIndex;
        return (
          <div key={q.id} className={`mcq ${reviewed ? (correct ? "is-correct" : "is-wrong") : ""}`} id={`q-${q.id}`}>
            <div className="mcq-head">
              <span className="qnum">{q.number}</span>
              <span className="mcq-prompt">{q.prompt}</span>
              {reviewed && <Badge tone={correct ? "good" : "bad"}>{correct ? "Đúng" : chosen === null ? "Bỏ trống" : "Sai"}</Badge>}
            </div>
            <div className="options">
              {q.options.map((o, i) => {
                const cls = [
                  "option",
                  chosen === i ? "chosen" : "",
                  reviewed && i === q.answerIndex ? "answer" : "",
                  reviewed && chosen === i && i !== q.answerIndex ? "wrong" : "",
                ].join(" ");
                return (
                  <label key={i} className={cls}>
                    <input type="radio" name={q.id} checked={chosen === i} disabled={reviewed || disabled} onChange={() => onAnswer(q.id, i)} />
                    <span className="opt-letter">{LETTERS[i]}</span>
                    <span>
                      {o.text}
                      {reviewed && o.whyVi && <span className="why">{o.whyVi}{o.trap && o.trap !== "none" ? ` · Bẫy: ${TRAPS[o.trap] ?? o.trap}` : ""}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {reviewed && (
              <div className="explain">
                <div className="row gap-s wrap">
                  <Badge tone="info">{CATEGORIES[skill][q.category] ?? q.category}</Badge>
                  {q.evidence && onEvidence && <button className="btn small ghost" onClick={() => onEvidence(q.evidence)}>Xem bằng chứng</button>}
                  <button
                    className="btn small ghost"
                    onClick={() => tutor.ask(chosen === q.answerIndex ? "Giải thích thêm cho tôi câu này." : "Vì sao đáp án tôi chọn sai và làm sao nhận ra đáp án đúng?", {
                      exercise: exerciseTitle, skill, question: q.prompt, options: q.options.map((o) => o.text),
                      learnerAnswer: chosen === null ? "(blank)" : q.options[chosen].text, correctAnswer: q.options[q.answerIndex].text,
                      evidence: q.evidence, explanation: q.explanationVi, category: q.category,
                    })}
                  ><Icon name="message-circle" /> Hỏi tutor</button>
                </div>
                {q.evidence && <blockquote>“{q.evidence}”</blockquote>}
                <p>{q.explanationVi}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
