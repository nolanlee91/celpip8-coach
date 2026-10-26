// CELPIP-General test structure used for practice and mock exams.
// Source: publicly described CELPIP-General format (Paragon Testing Enterprises).
// Timings marked "approx" are practice approximations — verify against celpip.ca before test day.

export type Skill = "reading" | "listening" | "writing" | "speaking";

export const SKILLS: Skill[] = ["listening", "reading", "writing", "speaking"];

export const SKILL_LABEL: Record<Skill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
};

export interface ObjectivePartSpec {
  id: string;
  part: number;
  name: string;
  questions: number;
  minutes: number; // approx time to answer the part
  description: string;
}

export const READING_PARTS: ObjectivePartSpec[] = [
  { id: "R1", part: 1, name: "Reading Correspondence", questions: 11, minutes: 11, description: "A personal or business letter/email with comprehension questions, then a reply with blanks to complete." },
  { id: "R2", part: 2, name: "Reading to Apply a Diagram", questions: 8, minutes: 9, description: "A diagram (schedule, menu, map, price table) plus an email with blanks that require applying the diagram." },
  { id: "R3", part: 3, name: "Reading for Information", questions: 9, minutes: 10, description: "A four-paragraph informational text (A–D); match each statement to a paragraph, or E if not given." },
  { id: "R4", part: 4, name: "Reading for Viewpoints", questions: 10, minutes: 13, description: "An article presenting several viewpoints, then a reader comment with blanks." },
];

export const LISTENING_PARTS: ObjectivePartSpec[] = [
  { id: "L1", part: 1, name: "Listening to Problem Solving", questions: 8, minutes: 8, description: "A conversation in three sections about solving a problem; questions follow each section." },
  { id: "L2", part: 2, name: "Listening to a Daily Life Conversation", questions: 5, minutes: 5, description: "A conversation about an everyday situation; questions follow the audio." },
  { id: "L3", part: 3, name: "Listening for Information", questions: 6, minutes: 6, description: "A conversation in which one speaker gives information to another." },
  { id: "L4", part: 4, name: "Listening to a News Item", questions: 5, minutes: 5, description: "A short news report about a local or human-interest event." },
  { id: "L5", part: 5, name: "Listening to a Discussion", questions: 8, minutes: 8, description: "A discussion among three or more people (a video in the real test; audio-only here)." },
  { id: "L6", part: 6, name: "Listening to Viewpoints", questions: 6, minutes: 6, description: "A talk presenting a viewpoint on an issue, often with opposing views." },
];

export interface WritingTaskSpec {
  id: string;
  task: number;
  name: string;
  minutes: number;
  minWords: number;
  maxWords: number;
}

export const WRITING_TASKS: WritingTaskSpec[] = [
  { id: "W1", task: 1, name: "Writing an Email", minutes: 27, minWords: 150, maxWords: 200 },
  { id: "W2", task: 2, name: "Responding to Survey Questions", minutes: 26, minWords: 150, maxWords: 200 },
];

export interface SpeakingTaskSpec {
  id: string;
  task: number;
  name: string;
  prepSec: number;
  speakSec: number;
  selectSec?: number; // Task 5 choose-an-option phase
  visual: "none" | "scene" | "options";
}

export const SPEAKING_TASKS: SpeakingTaskSpec[] = [
  { id: "S1", task: 1, name: "Giving Advice", prepSec: 30, speakSec: 90, visual: "none" },
  { id: "S2", task: 2, name: "Talking about a Personal Experience", prepSec: 30, speakSec: 60, visual: "none" },
  { id: "S3", task: 3, name: "Describing a Scene", prepSec: 30, speakSec: 60, visual: "scene" },
  { id: "S4", task: 4, name: "Making Predictions", prepSec: 30, speakSec: 60, visual: "scene" },
  { id: "S5", task: 5, name: "Comparing and Persuading", selectSec: 60, prepSec: 60, speakSec: 60, visual: "options" },
  { id: "S6", task: 6, name: "Dealing with a Difficult Situation", prepSec: 60, speakSec: 60, visual: "none" },
  { id: "S7", task: 7, name: "Expressing Opinions", prepSec: 30, speakSec: 90, visual: "none" },
  { id: "S8", task: 8, name: "Describing an Unusual Situation", prepSec: 30, speakSec: 60, visual: "scene" },
];

export function taskName(taskType: string): string {
  const all = [...READING_PARTS, ...LISTENING_PARTS, ...WRITING_TASKS, ...SPEAKING_TASKS];
  return all.find((t) => t.id === taskType)?.name ?? taskType;
}

export function skillOfTask(taskType: string): Skill {
  const c = taskType[0];
  return c === "R" ? "reading" : c === "L" ? "listening" : c === "W" ? "writing" : "speaking";
}

// Mistake categories ("why the mistake happened"), per skill.
export const CATEGORIES: Record<Skill, Record<string, string>> = {
  reading: {
    vocabulary: "Thiếu từ vựng",
    inference: "Suy luận (inference)",
    paraphrase: "Không nhận ra paraphrase",
    main_idea: "Nhầm ý chính",
    distractor: "Mắc bẫy đáp án nhiễu",
    detail: "Xác định chi tiết",
    time_management: "Quản lý thời gian",
    grammar: "Hiểu cấu trúc ngữ pháp",
  },
  listening: {
    missed_info: "Bỏ lỡ thông tin chính",
    paraphrase: "Không nhận ra paraphrase",
    speaker_attitude: "Hiểu sai thái độ người nói",
    long_conversation: "Mất mạch hội thoại dài",
    vocabulary: "Không nhận ra từ vựng khi nghe",
    similar_choices: "Không phân biệt đáp án gần giống",
  },
  writing: {
    task_fulfillment: "Hoàn thành yêu cầu đề",
    coherence: "Mạch lạc & tổ chức",
    vocabulary_range: "Độ phong phú từ vựng",
    grammar: "Ngữ pháp",
    tone_register: "Giọng văn / mức độ trang trọng",
  },
  speaking: {
    task_fulfillment: "Hoàn thành yêu cầu đề",
    coherence: "Mạch lạc & tổ chức ý",
    vocabulary_range: "Độ phong phú từ vựng",
    grammar: "Ngữ pháp & cấu trúc câu",
    fluency_hesitation: "Ngập ngừng / lặp từ",
    timing: "Dùng thời gian chưa hiệu quả",
  },
};

// Distractor trap types — tags on wrong answer options, used to explain *how* the learner was misled.
export const TRAPS: Record<string, string> = {
  word_match: "Lặp lại từ trong bài nhưng sai nghĩa",
  opposite: "Ngược nghĩa với bài",
  not_mentioned: "Không được nhắc đến",
  partially_true: "Đúng một phần",
  too_broad: "Quá chung chung / quá rộng",
  wrong_speaker: "Ý của người khác / nhân vật khác",
  wrong_detail: "Sai chi tiết (số, ngày, tên...)",
  none: "Đáp án đúng",
};

export const UNOFFICIAL_NOTICE =
  "Nội dung luyện tập do AI tạo — KHÔNG phải tài liệu chính thức của CELPIP/Paragon. Mọi mức điểm hiển thị chỉ là ước tính luyện tập, không tương đương điểm thi chính thức.";
