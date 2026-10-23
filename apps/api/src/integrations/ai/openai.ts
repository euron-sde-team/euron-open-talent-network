/**
 * OpenAI-compatible provider (chat completions with strict JSON schemas, and audio
 * transcription). Used against api.openai.com in production and against apps/ai-stub
 * in tests and local development, so both run the same client code.
 */
import { BADGES_SYSTEM, POLISH_SYSTEM, PORTFOLIO_SYSTEM } from "./prompts";
import type { AiProvider, AiUsage, ExtractInput } from "./provider";
import { BADGES_SCHEMA, POLISH_SCHEMA, PORTFOLIO_SCHEMA } from "./schema";

const TIMEOUT_MS = 90_000;

interface Endpoint {
  baseUrl: string;
  apiKey?: string;
  model: string;
  transcribeModel: string;
}

type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

async function call(e: Endpoint, path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${e.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(e.apiKey ? { Authorization: `Bearer ${e.apiKey}` } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AI provider answered ${res.status}`);
  return res;
}

async function jsonChat(e: Endpoint, name: string, schema: object, system: string, user: Content): Promise<{ raw: unknown; usage: AiUsage }> {
  const res = await call(e, "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: e.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  });
  const body = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const msg = body.choices?.[0]?.message;
  if (!msg?.content) throw new Error(msg?.refusal ? "The AI declined this input" : "The AI returned nothing");
  return { raw: JSON.parse(msg.content), usage: { model: e.model, tokensIn: body.usage?.prompt_tokens ?? 0, tokensOut: body.usage?.completion_tokens ?? 0 } };
}

export function openAiCompatible(name: string, endpoint: () => Endpoint): AiProvider {
  return {
    name,
    async transcribe(audio) {
      const e = endpoint();
      const form = new FormData();
      form.append("model", e.transcribeModel);
      form.append("file", new Blob([new Uint8Array(audio.buffer)], { type: audio.mime }), audio.fileName);
      const res = await call(e, "/audio/transcriptions", { method: "POST", body: form });
      const body = (await res.json()) as { text?: string };
      return { text: (body.text ?? "").slice(0, 30_000), usage: { model: e.transcribeModel, tokensIn: 0, tokensOut: 0 } };
    },
    async extract(input: ExtractInput) {
      const e = endpoint();
      const parts: Exclude<Content, string> = [];
      if (input.text?.trim()) parts.push({ type: "text", text: input.text });
      if (input.image) parts.push({ type: "image_url", image_url: { url: `data:${input.image.mime};base64,${input.image.buffer.toString("base64")}` } });
      if (!parts.length) throw new Error("Nothing to read");
      return jsonChat(e, "talent_portfolio", PORTFOLIO_SCHEMA, PORTFOLIO_SYSTEM, parts);
    },
    async badges(proposalJson) {
      return jsonChat(endpoint(), "talent_badges", BADGES_SCHEMA, BADGES_SYSTEM, proposalJson);
    },
    async polish(field, text) {
      const { raw, usage } = await jsonChat(endpoint(), "polish", POLISH_SCHEMA, POLISH_SYSTEM, `Field: ${field}\n\n${text}`);
      return { text: String((raw as { text?: unknown }).text ?? ""), usage };
    },
  };
}
