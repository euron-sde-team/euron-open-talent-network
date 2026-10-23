/**
 * Text out of uploaded documents, in-process: PDF (unpdf), DOCX (mammoth), plain text.
 * Images and audio are not text; providers handle them (vision, transcription).
 * Output is clamped so a huge document cannot blow the model's context or the bill.
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_TEXT = 30_000;

export async function documentText(buffer: Buffer, mime: string): Promise<string> {
  let text = "";
  if (mime === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const out = await extractText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
  } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (mime.startsWith("text/")) {
    text = buffer.toString("utf8");
  }
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}
