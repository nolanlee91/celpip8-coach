import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Attempt, ContentItem, Evaluation } from "../../shared/types";
import { taskName } from "../../shared/spec";
import { api } from "../api";
import { Card, ErrorBox, Loading, Unofficial } from "../components/ui";
import { Passage } from "../components/Passage";
import { McqList } from "../components/Mcq";
import { Transcript } from "../components/ListeningPlayer";
import { EvaluationView } from "../components/Results";
import { SceneImage } from "../components/SpeakingRunner";

/** Read-only review of a past objective attempt: passage/transcript, answers, explanations. */
export function ReviewPage() {
  const { id } = useParams();
  const [data, setData] = useState<{ attempt: Attempt; content: ContentItem | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);
  useEffect(() => { api<typeof data>(`/api/attempts/${id}`).then(setData).catch((e) => setError(e.message)); }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { attempt, content } = data;
  if (!content || (content.kind !== "reading" && content.kind !== "listening")) return <ErrorBox error="Nội dung bài không còn." />;
  const answers = Object.fromEntries(attempt.items.map((it) => [it.questionId, it.chosenIndex]));
  const questions = content.kind === "reading" ? content.questions : content.chunks.flatMap((c) => c.questions);
  return (
    <div className="page">
      <h2>{taskName(attempt.taskType)} — {content.title}</h2>
      <p className="muted">{attempt.finishedAt.slice(0, 10)} · {attempt.correct}/{attempt.total} · độ khó {attempt.difficulty} · chế độ {attempt.mode}</p>
      <Unofficial compact />
      <div className="split">
        <div className="split-left">
          {content.kind === "reading"
            ? content.sections.map((s, i) => <Passage key={i} section={s} evidence={questions.map((q) => q.evidence)} activeEvidence={activeEvidence} sourceLabel={`reading:${content.taskType}`} />)
            : <Card title="Transcript">{content.chunks.map((c, i) => <Transcript key={i} segments={c.segments} evidence={c.questions.map((q) => q.evidence)} />)}</Card>}
        </div>
        <div className="split-right">
          <McqList questions={questions} answers={answers} onAnswer={() => {}} reviewed skill={content.kind} exerciseTitle={content.title} onEvidence={content.kind === "reading" ? setActiveEvidence : undefined} />
        </div>
      </div>
    </div>
  );
}

export function EvaluationPage() {
  const { id } = useParams();
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [content, setContent] = useState<ContentItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Evaluation>(`/api/evaluations/${id}`).then((e) => {
      setEv(e);
      return api<ContentItem>(`/api/content/${e.contentId}`).then(setContent);
    }).catch((e) => setError(e.message));
  }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!ev) return <Loading />;
  return (
    <div className="page">
      <h2>{taskName(ev.taskType)}</h2>
      <Unofficial compact />
      {content && (content.kind === "writing" || content.kind === "speaking") && (
        <Card title="Đề bài">
          {content.kind === "writing" ? (
            <>
              <p>{content.situation}</p>
              {content.optionA && <p>A: {content.optionA}<br />B: {content.optionB}</p>}
              <ul>{content.instructions.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          ) : (
            <>
              <p>{content.prompt}</p>
              {content.svg && <SceneImage svg={content.svg} />}
              {content.options && <ul>{content.options.map((o) => <li key={o.title}><strong>{o.title}</strong>: {o.details.join("; ")}</li>)}</ul>}
            </>
          )}
        </Card>
      )}
      <EvaluationView ev={ev} audioUrl={ev.meta.audioFile ? `/api/audio/${ev.meta.audioFile}` : null} />
    </div>
  );
}
