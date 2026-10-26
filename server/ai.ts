// Layer C: optional AI assistance (Gemini). Used only for writing/speaking evaluation on request,
// the tutor, and explicit admin content/audio generation — never during ordinary practice.

import { ApiError, GoogleGenAI, type Content, type GenerateContentResponse, type GenerateContentResponseUsageMetadata } from "@google/genai";
import type { Response } from "express";
import type { AiUsageEntry } from "../shared/types";

// Defaults favour models with a free tier; override in .env.
export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

let client: GoogleGenAI | null = null;
export function getClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new AiError("Chưa cấu hình GEMINI_API_KEY. Các tính năng không cần AI vẫn hoạt động bình thường.", 503);
  }
  if (availability.rateLimitedUntil && Date.now() < Date.parse(availability.rateLimitedUntil)) {
    throw new AiError(`Gemini đang bị giới hạn tốc độ — thử lại sau ${new Date(availability.rateLimitedUntil).toLocaleTimeString()}.`, 429);
  }
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export class AiError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export const aiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

// ---------- availability + usage tracking ----------

export const availability = {
  lastSuccessAt: null as string | null,
  lastError: null as { message: string; status: number; at: string } | null,
  rateLimitedUntil: null as string | null,
};

type UsageSink = (e: AiUsageEntry) => void;
const sinks = new Set<UsageSink>();
/** The server persists usage into ai.json; generation jobs also tally their own tokens. Returns an unsubscribe fn. */
export const onUsage = (fn: UsageSink) => { sinks.add(fn); return () => { sinks.delete(fn); }; };
const sink: UsageSink = (e) => { for (const fn of sinks) fn(e); };

export function recordUsage(kind: string, model: string, ok: boolean, u: GenerateContentResponseUsageMetadata | undefined, error: string | null, cached = false) {
  if (ok) availability.lastSuccessAt = new Date().toISOString();
  sink({
    at: new Date().toISOString(), kind, model, ok, cached,
    promptTokens: u?.promptTokenCount ?? 0,
    outputTokens: u?.candidatesTokenCount ?? 0,
    thoughtsTokens: u?.thoughtsTokenCount ?? 0,
    totalTokens: u?.totalTokenCount ?? 0,
    error,
  });
}

// ---------- JSON-schema helpers (closed objects keep Gemini's output strictly shaped) ----------

type Schema = Record<string, unknown>;
export const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
export const int = (description?: string): Schema => ({ type: "integer", ...(description ? { description } : {}) });
export const num = (description?: string): Schema => ({ type: "number", ...(description ? { description } : {}) });
export const enumOf = (values: string[], description?: string): Schema => ({ type: "string", enum: values, ...(description ? { description } : {}) });
export const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
export const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });
export const obj = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description ? { description } : {}),
});

export type Effort = "low" | "medium" | "high";

// Thinking budget in tokens; -1 lets the model decide.
const THINKING: Record<Effort, number> = { low: 1024, medium: -1, high: 24576 };

export function describeError(err: unknown): AiError {
  let out: AiError;
  if (err instanceof AiError) out = err;
  else if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) out = new AiError("GEMINI_API_KEY không hợp lệ. Kiểm tra lại key.", 401);
    else if (err.status === 401 || err.status === 403) out = new AiError("GEMINI_API_KEY không hợp lệ hoặc không có quyền (401/403).", 401);
    else if (err.status === 404) out = new AiError(`Không tìm thấy model. Kiểm tra GEMINI_MODEL / GEMINI_TTS_MODEL trong .env.`, 502);
    else if (err.status === 429) {
      // Back off for a minute so repeated clicks don't burn more of the quota.
      availability.rateLimitedUntil = new Date(Date.now() + 60_000).toISOString();
      out = new AiError("Vượt hạn mức/giới hạn tốc độ của Gemini (429). Thử lại sau khoảng 1 phút hoặc kiểm tra quota.", 429);
    } else out = new AiError(`Lỗi Gemini API ${err.status}: ${err.message}`, 502);
  } else out = new AiError(err instanceof Error ? err.message : String(err), 500);
  if (out.status !== 503) availability.lastError = { message: out.message, status: out.status, at: new Date().toISOString() };
  return out;
}

function checkFinish(res: GenerateContentResponse) {
  const blocked = res.promptFeedback?.blockReason;
  if (blocked) throw new AiError(`Gemini chặn yêu cầu này (${blocked}).`, 422);
  const reason = res.candidates?.[0]?.finishReason;
  if (reason === "MAX_TOKENS") throw new AiError("Phản hồi bị cắt do vượt giới hạn độ dài. Thử lại.", 502);
  if (reason && reason !== "STOP") throw new AiError(`Gemini dừng bất thường (${reason}). Thử lại.`, 422);
}

/** One structured-output call; learner-specific content goes in the user message. */
export async function callJSON<T>(opts: {
  kind: string;
  system: string;
  user: string;
  schema: Schema;
  effort?: Effort;
  maxTokens?: number;
}): Promise<T> {
  try {
    const res = await getClient().models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: opts.schema,
        maxOutputTokens: opts.maxTokens ?? 32768,
        thinkingConfig: { thinkingBudget: THINKING[opts.effort ?? "medium"] },
      },
    });
    recordUsage(opts.kind, MODEL, true, res.usageMetadata, null);
    checkFinish(res);
    const text = res.text;
    if (!text) throw new AiError("Gemini trả về phản hồi rỗng. Thử lại.", 502);
    return JSON.parse(text) as T;
  } catch (err) {
    const e = describeError(err);
    if (e.status !== 503) recordUsage(opts.kind, MODEL, false, undefined, e.message);
    throw e;
  }
}

/** Streams a tutor reply to the browser as Server-Sent Events. */
export async function streamChat(res: Response, system: string, messages: { role: "user" | "assistant"; content: string }[]) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const contents: Content[] = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  let usage: GenerateContentResponseUsageMetadata | undefined;
  try {
    const stream = await getClient().models.generateContentStream({
      model: MODEL,
      contents,
      config: { systemInstruction: system, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: THINKING.low } },
    });
    for await (const chunk of stream) {
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      if (chunk.promptFeedback?.blockReason) {
        send("delta", "\n\n_(Gemini không thể trả lời câu hỏi này.)_");
        break;
      }
      const text = chunk.text;
      if (text) send("delta", text);
    }
    recordUsage("tutor", MODEL, true, usage, null);
    send("done", {});
  } catch (err) {
    const e = describeError(err);
    if (e.status !== 503) recordUsage("tutor", MODEL, false, usage, e.message);
    send("error", e.message);
  } finally {
    res.end();
  }
}
