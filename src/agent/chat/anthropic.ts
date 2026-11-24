// The Anthropic message shapes both tool loops build: the page's (your own
// key, src/agent/chat/runners.ts) and the cloud server's (Odaja's AI,
// backend/ai/turn.ts). Types only from the SDK, so the server and the page
// share them without loading it.
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "../tools";
import type { ImageInput } from "./types";

// The API's server-side refusal fallback ("default" routing).
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// A tool result in a line, for the chat's tool chips.
export const summarize = (result: ToolResult): string => result.content.map((c) => (c.type === "text" ? c.text : "(image)")).join(" ").slice(0, 300);

const imageBlock = (img: ImageInput) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType as "image/jpeg", data: img.data } });

// The user's message: their photos first, then the text.
export const userMessage = (images: ImageInput[], text: string): Anthropic.Beta.BetaMessageParam => ({
  role: "user",
  content: [...images.map(imageBlock), { type: "text" as const, text }],
});

export const toolResultBlock = (toolUseId: string, result: ToolResult): Anthropic.Beta.BetaToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: toolUseId,
  is_error: result.isError || undefined,
  content: result.content.map((c) => (c.type === "text" ? { type: "text" as const, text: c.text } : imageBlock(c))),
});

// The History entry kept before an AI reply on a cloud home.
export function beforeAiLabel(text: string): string {
  const summary = text.trim().replace(/\s+/g, " ") || "an AI reply";
  return `Before: ${summary.length > 60 ? `${summary.slice(0, 57)}…` : summary}`;
}
