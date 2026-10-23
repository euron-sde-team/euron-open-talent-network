/**
 * Fake AI provider: speaks the OpenAI wire format (moderations, chat completions with a
 * JSON schema, audio transcriptions) so the API's "stub" providers exercise the same
 * client code as production, with no network or key. Deterministic: the same input
 * always gives the same output, so tests can assert on it.
 *
 * Moderation scores come from markers in the text, e.g. "[[mod:harassment=0.97]]" (any
 * category, several allowed). Everything else scores 0.01. An image whose URL contains
 * "flag-image" scores sexual=0.99; for a local signed media URL the storage key is
 * hidden in a base64url payload, so that payload is decoded and checked too.
 *
 * Chat completions pick the task from response_format.json_schema.name:
 *   talent_portfolio  a profile proposal built from the text with simple patterns
 *                     ("Title at Company (2019-2023)", known skills, URLs, schools)
 *   talent_badges     one badge quoting the text verbatim, and one decoy whose quote is
 *                     NOT in the text (the API must drop it: badges need evidence)
 *   polish            the text, tidied
 * The marker "[[ai:fail]]" anywhere in the input answers 500 (error-path tests).
 *
 *   PORT=5109 node server.mjs
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

const CATEGORIES = [
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
];

const MARKER = /\[\[mod:([a-z/-]+)=([0-9.]+)\]\]/gi;

function imageFlagged(url) {
  if (typeof url !== "string") return false;
  if (url.includes("flag-image")) return true;
  const m = url.match(/\/api\/media\/local\/([A-Za-z0-9_-]+)\./);
  if (!m) return false;
  try {
    return Buffer.from(m[1], "base64url").toString("utf8").includes("flag-image");
  } catch {
    return false;
  }
}

export function score(input) {
  const items = Array.isArray(input) ? input : [{ type: "text", text: String(input ?? "") }];
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0.01]));
  for (const item of items) {
    if (typeof item === "string" || item?.type === "text") {
      const text = typeof item === "string" ? item : String(item.text ?? "");
      for (const [, cat, val] of text.matchAll(MARKER)) scores[cat.toLowerCase()] = Math.max(scores[cat.toLowerCase()] ?? 0, Number(val));
    } else if (item?.type === "image_url" && imageFlagged(item.image_url?.url)) {
      scores.sexual = Math.max(scores.sexual, 0.99);
    }
  }
  const categories = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v >= 0.5]));
  return { flagged: Object.values(categories).some(Boolean), categories, category_scores: scores };
}

const KNOWN_SKILLS = ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "SQL", "PostgreSQL", "React", "Next.js", "Node.js", "GraphQL", "Docker", "Kubernetes", "AWS", "Terraform", "Machine Learning", "PyTorch", "Figma", "Product Management", "Data Analysis"];
const ROLE = /^(.{2,80}?)\s+at\s+(.{2,80}?)\s*\((\d{4})(?:-(\d{4}|present|now))?\)/i;
// Resume styles: "Since 2021: Title at Company, what you did" and "2018 to 2021: Title at Company, ...".
const ROLE_SINCE = /^since\s+(\d{4})\s*:\s*(.{2,80}?)\s+at\s+([^,.;]{2,80})[,.;]?\s*(.*)$/i;
const ROLE_RANGE = /^(\d{4})\s+(?:to|-)\s+(\d{4}|present|now)\s*:\s*(.{2,80}?)\s+at\s+([^,.;]{2,80})[,.;]?\s*(.*)$/i;
const DEGREE = /^(?:education\s*:\s*)?(BSc|BA|BEng|MSc|MA|MBA|MEng|PhD|BS|MS)\s+([^,]{2,80}),\s*([^,]{2,120}?)(?:,\s*(\d{4}))?\.?$/i;
const URL_RE = /https?:\/\/[^\s)]+/g;

function portfolio(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const experience = [];
  const education = [];
  const used = new Set();
  for (const line of lines) {
    const since = ROLE_SINCE.exec(line);
    const range = since ? null : ROLE_RANGE.exec(line);
    const degree = DEGREE.exec(line);
    if (since || range) {
      used.add(line);
      const [start, end, title, company, rest] = since ? [since[1], null, since[2], since[3], since[4]] : [range[1], /^\d{4}$/.test(range[2]) ? range[2] : null, range[3], range[4], range[5]];
      const what = rest.replace(/^(building|owned|owning|leading|led)\b/i, (w) => w[0].toUpperCase() + w.slice(1)).trim();
      experience.push({ title: title.trim(), companyName: company.trim(), employmentType: null, workplaceType: null, location: null, startMonth: `${start}-01`, endMonth: end ? `${end}-12` : null, description: what ? what.replace(/\.?$/, ".") : null, skills: [] });
      continue;
    }
    if (degree) {
      used.add(line);
      education.push({ institution: degree[3].trim(), degree: degree[1], field: degree[2].trim(), startYear: degree[4] ? Number(degree[4]) - 4 : null, endYear: degree[4] ? Number(degree[4]) : null, grade: null, description: null });
      continue;
    }
    const m = ROLE.exec(line);
    if (m) {
      const end = m[4] && /^\d{4}$/.test(m[4]) ? `${m[4]}-12` : null;
      experience.push({ title: m[1], companyName: m[2], employmentType: null, workplaceType: null, location: null, startMonth: `${m[3]}-01`, endMonth: end, description: null, skills: [] });
    } else if (/university|college|institute|school/i.test(line)) {
      education.push({ institution: line.slice(0, 160), degree: null, field: null, startYear: null, endYear: null, grade: null, description: null });
    }
  }
  const skills = KNOWN_SKILLS.filter((s) => new RegExp(`(?<![\\w.])${s.replace(/[.+]/g, "\\$&")}(?![\\w])`, "i").test(text)).map((name) => ({ name, category: null, years: null }));
  const links = [...new Set(text.match(URL_RE) ?? [])].slice(0, 5).map((url) => ({ kind: url.includes("github.com") ? "GITHUB" : "WEBSITE", url, label: null, featured: false }));
  const first = lines[0] ?? "";
  const prose = lines.slice(1).filter((l) => !used.has(l) && !/^(skills|portfolio|links?)\s*:/i.test(l));
  const years = experience.length ? new Date().getUTCFullYear() - Math.min(...experience.map((e) => Number(e.startMonth.slice(0, 4)))) : null;
  return {
    headline: first.slice(0, 120) || null,
    about: prose.slice(0, 3).join(" ").slice(0, 600) || null,
    currentTitle: experience.find((e) => !e.endMonth)?.title ?? null,
    location: null,
    yearsExperience: years,
    experience,
    education,
    projects: [],
    skills,
    certifications: [],
    links,
    missingInfo: [experience.length ? null : "experience", "projects"].filter(Boolean),
  };
}

function badges(proposalText) {
  const skill = KNOWN_SKILLS.find((s) => proposalText.includes(s));
  const out = [];
  if (skill) out.push({ kind: "ROLE_FIT", slug: `fit-${skill.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label: `${skill} practitioner`, rationale: `Lists ${skill} in their experience.`, evidenceQuote: skill, confidence: 0.9 });
  out.push({ kind: "ACHIEVEMENT", slug: "decoy-award", label: "Award winner", rationale: "Not supported by the text.", evidenceQuote: "won the global excellence award 2031", confidence: 0.99 });
  return { badges: out };
}

function chatText(messages) {
  return (messages ?? [])
    .filter((m) => m.role === "user")
    .flatMap((m) => (typeof m.content === "string" ? [m.content] : (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text)))
    .join("\n");
}

function completion(body) {
  const task = body?.response_format?.json_schema?.name ?? "polish";
  const text = chatText(body.messages);
  if (text.includes("[[ai:fail]]")) return null;
  let content;
  if (task === "talent_portfolio") content = JSON.stringify(portfolio(text));
  else if (task === "talent_badges") content = JSON.stringify(badges(text));
  else content = JSON.stringify({ text: text.replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()) });
  return { id: `chatcmpl-stub-${Date.now()}`, object: "chat.completion", model: body.model ?? "stub", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: Math.ceil(text.length / 4), completion_tokens: Math.ceil(content.length / 4) } };
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function handler(req, res) {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) return send(res, 200, { ok: true });
  if (req.method === "POST" && req.url === "/v1/moderations") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { error: { message: "invalid json" } });
      }
      send(res, 200, { id: `modr-stub-${Date.now()}`, model: body.model ?? "stub", results: [score(body.input)] });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 20_000_000) req.destroy();
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { error: { message: "invalid json" } });
      }
      const out = completion(body);
      if (!out) return send(res, 500, { error: { message: "stub failure requested" } });
      send(res, 200, out);
    });
    return;
  }
  if (req.method === "POST" && req.url === "/v1/audio/transcriptions") {
    req.resume();
    req.on("end", () => send(res, 200, { text: "Voice note. Senior Engineer at Northwind Labs (2018-present). I work with TypeScript and React." }));
    return;
  }
  send(res, 404, { error: { message: "not found" } });
}

/** Start on `port` (0 = ephemeral). Tests import this. */
export function startStub(port = 0) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 5109);
  const server = http.createServer(handler);
  server.listen(port, "0.0.0.0", () => console.log(`ai stub listening on ${port}`));
}
