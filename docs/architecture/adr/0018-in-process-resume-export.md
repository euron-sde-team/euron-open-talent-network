# ADR 0018: In-process PDF and DOCX resume export

## Status

Accepted.

## Context

A candidate can download their profile as a resume, as PDF or DOCX
(`GET /api/profiles/me/resume.pdf`, `.../resume.docx`). The common way to make a good
looking PDF is to render HTML in a headless browser. That adds a browser binary to the
image (size, patching, a sandbox that a read-only root filesystem complicates), seconds of
CPU per request, and a rendering surface that would process user-written profile text.

## Decision

- [`services/resume.service.ts`](../../../apps/api/src/services/resume.service.ts) builds
  both formats in the API process from the owner's `MyProfile`: PDF with `pdfkit` (A4,
  built-in Helvetica fonts, drawn section by section) and DOCX with the `docx` package
  (paragraphs, headings, `Packer` to a buffer). Both libraries are plain JavaScript
  dependencies of [`apps/api/package.json`](../../../apps/api/package.json).
- Only the owner can export; contact details appear because it is their own document. The
  route is rate limited (`resume-export`) and each export is logged in `resume_exports`
  for the admin overview.
- No HTML, no templates from user input, no network access while rendering.

## Consequences

Positive:

- No browser in the image, no extra service, fast and predictable output.
- Profile text is laid out as text, never interpreted as markup.

Trade-offs:

- The layout is code, not a template designers can edit, and there is one layout.
- Built-in PDF fonts cover Latin text; scripts outside them need an embedded font added to
  the service.

## Alternatives considered

- **Headless Chromium per request.** Rich layout, at the cost of image size, CPU and a
  browser to keep patched.
- **A separate rendering service or third-party API.** Another moving part, or profile
  data leaving the deployment.
- **Client-side generation.** Works offline, but every client would need its own copy of
  the layout and the DOCX format.
