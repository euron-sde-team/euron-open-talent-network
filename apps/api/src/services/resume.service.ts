/**
 * Resume export from the owner's profile: PDF (pdfkit, in-process; the source launched
 * a headless browser per request) or DOCX. Only the owner can export; contact details
 * appear because it is their own document. Each export is logged (admin analytics).
 */
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import type { MyProfile } from "@open-talent/types";
import type { Actor } from "../core/context";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { getMine } from "./profile.service";

function period(start: string | null, end: string | null): string {
  const fmt = (ym: string) => {
    const [y, m] = ym.split("-");
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  if (!start) return "";
  return `${fmt(start)} - ${end ? fmt(end) : "Present"}`;
}

function contactLine(p: MyProfile): string {
  return [p.contact.email, p.contact.phone, p.location, ...p.links.filter((l) => l.kind !== "YOUTUBE").slice(0, 3).map((l) => l.url.replace(/^https?:\/\//, ""))].filter(Boolean).join("  |  ");
}

export function renderPdf(p: MyProfile): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 54, right: 54 }, info: { Title: `${p.user.displayName} - Resume`, Author: p.user.displayName } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const ink = "#0f172a";
    const muted = "#475569";
    const accent = "#1d4ed8";
    const heading = (t: string) => {
      doc.moveDown(0.8).fillColor(accent).font("Helvetica-Bold").fontSize(11).text(t.toUpperCase(), { characterSpacing: 0.6 });
      doc.moveTo(doc.page.margins.left, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor("#cbd5e1").lineWidth(0.5).stroke();
      doc.moveDown(0.4);
    };
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(22).text(p.user.displayName);
    if (p.headline) doc.font("Helvetica").fontSize(11.5).fillColor(muted).text(p.headline);
    const contact = contactLine(p);
    if (contact) doc.moveDown(0.3).fontSize(9.5).fillColor(muted).text(contact);
    if (p.about) {
      heading("Summary");
      doc.font("Helvetica").fontSize(10).fillColor(ink).text(p.about, { lineGap: 2 });
    }
    if (p.experience.length) {
      heading("Experience");
      for (const e of p.experience) {
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(`${e.title}, ${e.companyName}`, { continued: false });
        doc.font("Helvetica").fontSize(9).fillColor(muted).text([period(e.startMonth, e.endMonth), e.location].filter(Boolean).join("  |  "));
        if (e.description) doc.moveDown(0.15).font("Helvetica").fontSize(10).fillColor(ink).text(e.description, { lineGap: 1.5 });
        if (e.skills.length) doc.font("Helvetica-Oblique").fontSize(9).fillColor(muted).text(e.skills.join(", "));
        doc.moveDown(0.5);
      }
    }
    if (p.projects.length) {
      heading("Projects");
      for (const pr of p.projects) {
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(pr.name);
        if (pr.url || pr.repoUrl) doc.font("Helvetica").fontSize(9).fillColor(accent).text([pr.url, pr.repoUrl].filter(Boolean).join("  |  "));
        if (pr.description) doc.font("Helvetica").fontSize(10).fillColor(ink).text(pr.description, { lineGap: 1.5 });
        doc.moveDown(0.4);
      }
    }
    if (p.education.length) {
      heading("Education");
      for (const ed of p.education) {
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(ed.institution);
        doc.font("Helvetica").fontSize(9.5).fillColor(muted).text([[ed.degree, ed.field].filter(Boolean).join(", "), [ed.startYear, ed.endYear].filter(Boolean).join(" - ")].filter(Boolean).join("  |  "));
        doc.moveDown(0.3);
      }
    }
    if (p.skills.length) {
      heading("Skills");
      doc.font("Helvetica").fontSize(10).fillColor(ink).text(p.skills.map((s) => s.name).join("  ·  "), { lineGap: 2 });
    }
    if (p.certifications.length) {
      heading("Certifications");
      for (const c of p.certifications) doc.font("Helvetica").fontSize(10).fillColor(ink).text([c.name, c.issuer, c.issuedMonth].filter(Boolean).join("  |  "));
    }
    doc.end();
  });
}

export async function renderDocx(p: MyProfile): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: p.user.displayName, bold: true })] }),
    ...(p.headline ? [new Paragraph({ children: [new TextRun({ text: p.headline, color: "475569" })] })] : []),
    ...(contactLine(p) ? [new Paragraph({ children: [new TextRun({ text: contactLine(p), size: 18, color: "475569" })] })] : []),
  ];
  const section = (t: string) => children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: t })] }));
  if (p.about) {
    section("Summary");
    children.push(new Paragraph({ children: [new TextRun(p.about)] }));
  }
  if (p.experience.length) {
    section("Experience");
    for (const e of p.experience) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${e.title}, ${e.companyName}`, bold: true })] }));
      children.push(new Paragraph({ children: [new TextRun({ text: [period(e.startMonth, e.endMonth), e.location].filter(Boolean).join("  |  "), color: "475569", size: 18 })] }));
      if (e.description) children.push(new Paragraph({ children: [new TextRun(e.description)] }));
    }
  }
  if (p.projects.length) {
    section("Projects");
    for (const pr of p.projects) {
      children.push(new Paragraph({ children: [new TextRun({ text: pr.name, bold: true })] }));
      if (pr.description) children.push(new Paragraph({ children: [new TextRun(pr.description)] }));
    }
  }
  if (p.education.length) {
    section("Education");
    for (const ed of p.education) children.push(new Paragraph({ children: [new TextRun({ text: ed.institution, bold: true }), new TextRun({ text: `  ${[ed.degree, ed.field].filter(Boolean).join(", ")}` })] }));
  }
  if (p.skills.length) {
    section("Skills");
    children.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun(p.skills.map((s) => s.name).join(", "))] }));
  }
  const doc = new Document({ creator: p.user.displayName, title: `${p.user.displayName} - Resume`, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export async function exportResume(actor: Actor, format: "PDF" | "DOCX"): Promise<{ body: Buffer; fileName: string; contentType: string }> {
  const profile = await getMine(actor);
  const body = format === "PDF" ? await renderPdf(profile) : await renderDocx(profile);
  await db.insertInto("resume_exports").values({ id: newId(), user_id: actor.id, format }).execute();
  const base = profile.user.username;
  return format === "PDF"
    ? { body, fileName: `${base}-resume.pdf`, contentType: "application/pdf" }
    : { body, fileName: `${base}-resume.docx`, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}
