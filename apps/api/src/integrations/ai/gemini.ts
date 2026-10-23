/**
 * Gemini provider: generateContent with a response schema. PDFs, images and audio are
 * sent inline (Gemini reads them natively, so no transcription step); everything else
 * arrives as text. Inline data only: nothing is uploaded to a provider-side file store,
 * so nothing is left there afterwards.
 */
import { BADGES_SYSTEM, POLISH_SYSTEM, PORTFOLIO_SYSTEM } from "./prompts";
import type { AiProvider, AiUsage, ExtractInput } from "./provider";
import { BADGES_SCHEMA, POLISH_SCHEMA, PORTFOLIO_SCHEMA } from "./schema";

const TIMEOUT_MS = 90_000;

/** Gemini's schema dialect: no additionalProperties, nullable instead of type unions. */
export function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "maxLength") continue;
    if (k === "type" && Array.isArray(v)) {
      out.type = String(v.find((t) => t !== "null")).toUpperCase();
      out.nullable = v.includes("null");
    } else if (k === "type") out.type = String(v).toUpperCase();
    else if (k === "enum" && Array.isArray(v)) out.enum = v.filter((x) => x !== null);
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function generate(e: Endpoint, system: string, parts: Part[], schema: object): Promise<{ raw: unknown; usage: AiUsage }> {
  const res = await fetch(`${e.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(e.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": e.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: toGeminiSchema(schema) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AI provider answered ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("The AI returned nothing");
  return { raw: JSON.parse(text), usage: { model: e.model, tokensIn: body.usageMetadata?.promptTokenCount ?? 0, tokensOut: body.usageMetadata?.candidatesTokenCount ?? 0 } };
}

export function geminiProvider(endpoint: () => Endpoint): AiProvider {
  return {
    name: "gemini",
    async transcribe(audio) {
      const e = endpoint();
      const { raw, usage } = await generate(e, "Transcribe this voice note verbatim. Answer with JSON { text }.", [{ inline_data: { mime_type: audio.mime, data: audio.buffer.toString("base64") } }], POLISH_SCHEMA);
      return { text: String((raw as { text?: unknown }).text ?? "").slice(0, 30_000), usage };
    },
    async extract(input: ExtractInput) {
      const parts: Part[] = [];
      if (input.text?.trim()) parts.push({ text: input.text });
      if (input.image) parts.push({ inline_data: { mime_type: input.image.mime, data: input.image.buffer.toString("base64") } });
      if (input.audio) parts.push({ inline_data: { mime_type: input.audio.mime, data: input.audio.buffer.toString("base64") } });
      if (!parts.length) throw new Error("Nothing to read");
      return generate(endpoint(), PORTFOLIO_SYSTEM, parts, PORTFOLIO_SCHEMA);
    },
    async badges(proposalJson) {
      return generate(endpoint(), BADGES_SYSTEM, [{ text: proposalJson }], BADGES_SCHEMA);
    },
    async polish(field, text) {
      const { raw, usage } = await generate(endpoint(), POLISH_SYSTEM, [{ text: `Field: ${field}\n\n${text}` }], POLISH_SCHEMA);
      return { text: String((raw as { text?: unknown }).text ?? ""), usage };
    },
  };
}
