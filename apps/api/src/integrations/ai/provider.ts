/**
 * The AI provider port. Three jobs: turn input into a profile proposal, propose badges
 * for a proposal, and polish a field. Every provider returns raw JSON; the caller
 * sanitises it (schema.ts), so a provider can never write unchecked data to a profile.
 */
export interface ExtractInput {
  /** Plain text: pasted, typed, extracted from a document, or transcribed. */
  text?: string;
  /** An image of a document (a photo of a resume), sent to a vision model. */
  image?: { buffer: Buffer; mime: string };
  /** A voice note, transcribed first. */
  audio?: { buffer: Buffer; mime: string; fileName: string };
}

export interface AiUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  name: string;
  /** Speech to text (used before extract for voice notes). */
  transcribe(audio: NonNullable<ExtractInput["audio"]>): Promise<{ text: string; usage: AiUsage }>;
  extract(input: ExtractInput): Promise<{ raw: unknown; usage: AiUsage }>;
  badges(proposalJson: string): Promise<{ raw: unknown; usage: AiUsage }>;
  polish(field: string, text: string): Promise<{ text: string; usage: AiUsage }>;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI is not configured on this server") {
    super(message);
  }
}
