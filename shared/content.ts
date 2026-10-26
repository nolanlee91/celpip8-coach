// Static content library schema (Layer A). Library items are authored as JSON files under
// content/ (git) or imported into $DATA_DIR/library (admin). They are never generated during practice.

import type { ListeningSet, ReadingSet, SpeakingPrompt, WritingPrompt } from "./types";

/** full = a complete CELPIP part; drill = shorter targeted practice; mock = reserved for mock-exam packages. */
export type ObjectiveSetType = "full" | "drill" | "mock";
/** practice = normal prompt bank; mock = reserved for mock-exam packages. */
export type PromptSetType = "practice" | "mock";

export type ContentSource = "curated" | "ai-generated";

export interface ReviewInfo {
  status: "approved" | "draft" | "rejected";
  reviewedBy: string; // e.g. "author+independent-ai-review", "human"
  notes: string;
}

export const TOPICS = [
  "workplace", "housing", "transportation", "customer-service", "community-services",
  "education", "healthcare", "shopping", "banking", "social", "environment", "recreation", "government",
] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABEL: Record<Topic, string> = {
  workplace: "Công việc", housing: "Nhà ở / thuê nhà", transportation: "Giao thông", "customer-service": "Dịch vụ khách hàng",
  "community-services": "Dịch vụ cộng đồng", education: "Giáo dục", healthcare: "Y tế", shopping: "Mua sắm", banking: "Ngân hàng",
  social: "Giao tiếp xã hội", environment: "Môi trường", recreation: "Giải trí", government: "Chính phủ / thủ tục",
};

export interface VocabEntry {
  id: string;
  term: string;
  definition: string;
  vi: string;
  example: string;
  collocations: string[];
  synonyms: string[];
  topic: Topic;
  difficulty: number; // 5–10 (CELPIP level where it becomes important)
  tasks: string[]; // related task ids, e.g. ["R4", "S7"]
}

export interface MockPackage {
  id: string;
  title: string;
  listening: string[]; // L1..L6 content ids, in order
  reading: string[]; // R1..R4
  writing: string[]; // W1, W2
  speaking: string[]; // S1..S8
}

export type LibraryItem = ReadingSet | ListeningSet | WritingPrompt | SpeakingPrompt;

export interface ValidationIssue {
  severity: "error" | "warning";
  id: string; // item / package / vocab id ("" when unknown)
  file: string;
  message: string;
}

/** Audio readiness of a listening set (Layer D). */
export interface AudioStatus {
  ready: boolean;
  chunks: { file: string | null; durationSec: number | null; hash: string }[];
}

export interface LibrarySummary {
  counts: Record<string, Record<string, number>>; // taskType -> setType -> count
  totals: { reading: number; listening: number; writing: number; speaking: number; vocabulary: number; mocks: number };
  targets: { reading: number; listening: number; writing: number; speaking: number; vocabulary: number };
  audioReady: number;
  audioPending: number;
  issues: ValidationIssue[];
}
