import { ApiError, GoogleGenAI, type Content, type GenerateContentResponse } from "@google/genai";
import type { Response } from "express";

// Override in .env when Google releases a newer model (e.g. GEMINI_MODEL=gemini-3-pro-preview).
export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new AiError("Chưa cấu hình GEMINI_API_KEY. Tạo file .env (xem .env.example) rồi khởi động lại server.", 503);
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

function describeError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) return new AiError("GEMINI_API_KEY không hợp lệ. Kiểm tra lại key.", 401);
    if (err.status === 401 || err.status === 403) return new AiError("GEMINI_API_KEY không hợp lệ hoặc không có quyền (401/403).", 401);
    if (err.status === 404) return new AiError(`Không tìm thấy model "${MODEL}". Đặt GEMINI_MODEL trong .env thành một model Gemini đang hoạt động.`, 502);
    if (err.status === 429) return new AiError("Vượt hạn mức/giới hạn tốc độ của Gemini (429). Thử lại sau ít phút hoặc kiểm tra quota.", 429);
    return new AiError(`Lỗi Gemini API ${err.status}: ${err.message}`, 502);
  }
  return new AiError(err instanceof Error ? err.message : String(err), 500);
}

function checkFinish(res: GenerateContentResponse) {
  const blocked = res.promptFeedback?.blockReason;
  if (blocked) throw new AiError(`Gemini chặn yêu cầu này (${blocked}). Thử tạo lại với chủ đề khác.`, 422);
  const reason = res.candidates?.[0]?.finishReason;
  if (reason === "MAX_TOKENS") throw new AiError("Phản hồi bị cắt do vượt giới hạn độ dài. Thử lại.", 502);
  if (reason && reason !== "STOP") throw new AiError(`Gemini dừng bất thường (${reason}). Thử lại.`, 422);
}

/** One structured-output call; learner-specific content goes in the user message. */
export async function callJSON<T>(opts: {
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
    checkFinish(res);
    const text = res.text;
    if (!text) throw new AiError("Gemini trả về phản hồi rỗng. Thử lại.", 502);
    return JSON.parse(text) as T;
  } catch (err) {
    throw describeError(err);
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
  try {
    const stream = await getClient().models.generateContentStream({
      model: MODEL,
      contents,
      config: { systemInstruction: system, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: THINKING.low } },
    });
    for await (const chunk of stream) {
      if (chunk.promptFeedback?.blockReason) {
        send("delta", "\n\n_(Gemini không thể trả lời câu hỏi này.)_");
        break;
      }
      const text = chunk.text;
      if (text) send("delta", text);
    }
    send("done", {});
  } catch (err) {
    send("error", describeError(err).message);
  } finally {
    res.end();
  }
}
