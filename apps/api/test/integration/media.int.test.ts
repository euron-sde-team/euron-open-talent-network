import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { config } from "../../src/core/config";
import { db } from "../../src/db/kysely";
import { storage } from "../../src/integrations/storage";
import { expireUploads } from "../../src/services/media.service";
import { anon, as, createUser } from "./harness";
import { getUrl, putBytes, TINY_PDF, TINY_PNG, upload } from "./media-helpers";
import { apply, block, connect, makeCompanyRecruiter, makeJob, makeProfile } from "./talent-fixtures";

const S3 = config.STORAGE === "s3";

describe("upload flow", () => {
  test("a JPEG is re-encoded: EXIF and GPS stripped, auto-rotated, thumbnail written, READY", async () => {
    const u = await createUser();
    // 40x20 with orientation 6 (rotate 90): after auto-rotation it is 20x40.
    const jpeg = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#3366cc" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: "secret-owner", Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .toBuffer();
    const { uploadId, res } = await upload(u, "POST", "offsite.jpg", "image/jpeg", jpeg);
    expect(res.body).toMatchObject({ id: uploadId, kind: "IMAGE", status: "READY", width: 20, height: 40, mimeType: "image/jpeg" });
    const stored = await getUrl(res.body.url);
    expect(stored.status).toBe(200);
    const meta = await sharp(stored.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(stored.body.includes(Buffer.from("secret-owner"))).toBe(false);
    const thumb = await getUrl(res.body.thumbUrl);
    expect((await sharp(thumb.body).metadata()).format).toBe("webp");
  });

  test("a .png that is really text is REJECTED and deleted from storage", async () => {
    const u = await createUser();
    const { uploadId, res } = await upload(u, "POST", "photo.png", "image/png", Buffer.from("<!doctype html><script>alert(1)</script>"), 400);
    expect(res.body.code).toBe("MEDIA_TYPE_MISMATCH");
    const row = await db.selectFrom("media_uploads").selectAll().where("id", "=", uploadId).executeTakeFirstOrThrow();
    expect(row.status).toBe("REJECTED");
    expect(await storage().head(row.storage_key)).toBeNull();
    // Completing again reports the rejection.
    expect((await as(u).post(`/api/media/uploads/${uploadId}/complete`).expect(400)).body.code).toBe("MEDIA_REJECTED");
  });

  test("types, extensions, sizes and purposes are checked up front", async () => {
    const u = await createUser();
    const bad = [
      { purpose: "POST", fileName: "x.svg", mimeType: "image/svg+xml", code: "MEDIA_TYPE_NOT_ALLOWED", status: 400 },
      { purpose: "POST", fileName: "x.html", mimeType: "text/html", code: "MEDIA_TYPE_NOT_ALLOWED", status: 400 },
      { purpose: "POST", fileName: "x.pdf", mimeType: "image/png", code: "MEDIA_EXTENSION_MISMATCH", status: 400 },
      { purpose: "POST", fileName: "x.png", mimeType: "image/png", code: "MEDIA_TOO_LARGE", status: 413, sizeBytes: 64 * 1024 * 1024 },
      { purpose: "AVATAR", fileName: "cv.pdf", mimeType: "application/pdf", code: "MEDIA_PURPOSE_MISMATCH", status: 400 },
      { purpose: "RESUME", fileName: "me.png", mimeType: "image/png", code: "MEDIA_PURPOSE_MISMATCH", status: 400 },
      { purpose: "COMMENT", fileName: "a.pdf", mimeType: "application/pdf", code: "MEDIA_PURPOSE_MISMATCH", status: 400 },
    ];
    for (const b of bad) {
      const res = await as(u).post("/api/media/uploads").send({ purpose: b.purpose, fileName: b.fileName, mimeType: b.mimeType, sizeBytes: b.sizeBytes ?? 100 });
      expect([res.status, res.body.code], b.fileName).toEqual([b.status, b.code]);
    }
    await as(u).post("/api/media/uploads").send({ purpose: "BANNER", fileName: "a.png", mimeType: "image/png", sizeBytes: 100 }).expect(400);
    await anon().post("/api/media/uploads").send({ purpose: "POST", fileName: "a.png", mimeType: "image/png", sizeBytes: 100 }).expect(401);
  });

  test("completing before the bytes arrive is UPLOAD_MISSING; the signed PUT enforces the length and type", async () => {
    const u = await createUser();
    const created = await as(u).post("/api/media/uploads").send({ purpose: "DM", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length + 10 }).expect(201);
    expect((await as(u).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(400)).body.code).toBe("UPLOAD_MISSING");
    if (!S3) {
      expect((await putBytes(created.body.put, TINY_PNG)).status).toBe(403);
      const right = await as(u).post("/api/media/uploads").send({ purpose: "DM", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length }).expect(201);
      expect((await putBytes({ url: right.body.put.url, headers: { "Content-Type": "text/html" } }, TINY_PNG)).status).toBe(403);
    }
  });

  test("only the owner completes or deletes; an unattached upload is deleted, an attached one is not", async () => {
    const [owner, other] = [await createUser(), await createUser()];
    const created = await as(owner).post("/api/media/uploads").send({ purpose: "POST", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length }).expect(201);
    await putBytes(created.body.put, TINY_PNG);
    await as(other).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(404);
    await as(other).delete(`/api/media/uploads/${created.body.uploadId}`).expect(404);
    await as(owner).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(200);
    await as(owner).delete(`/api/media/uploads/${created.body.uploadId}`).expect(204);
    await as(owner).get(`/api/media/${created.body.uploadId}`).expect(404);

    const { uploadId } = await upload(owner, "POST", "b.png", "image/png", TINY_PNG);
    await as(owner).post("/api/posts").send({ body: "with a picture", mediaIds: [uploadId] }).expect(201);
    expect((await as(owner).delete(`/api/media/uploads/${uploadId}`).expect(409)).body.code).toBe("MEDIA_IN_USE");
  });
});

describe("attaching by upload id", () => {
  test("someone else's upload id is rejected as an avatar, cover, post, comment or project cover", async () => {
    const [alice, mallory] = [await createUser(), await createUser()];
    const avatar = await upload(alice, "AVATAR", "me.png", "image/png", TINY_PNG);
    const post = await upload(alice, "POST", "p.png", "image/png", TINY_PNG);
    const cover = await upload(alice, "PROJECT_COVER", "c.png", "image/png", TINY_PNG);
    expect((await as(mallory).patch("/api/users/me").send({ avatarUploadId: avatar.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    expect((await as(mallory).put("/api/profiles/me/cover").send({ uploadId: avatar.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    expect((await as(mallory).post("/api/posts").send({ body: "stolen", mediaIds: [post.uploadId] }).expect(400)).body.code).toBe("MEDIA_INVALID");
    expect((await as(mallory).put("/api/profiles/me/sections/projects").send({ items: [{ name: "Mine", coverUploadId: cover.uploadId }] }).expect(400)).body.code).toBe("MEDIA_INVALID");
    // The owner may use them, and only for their purpose.
    expect((await as(alice).patch("/api/users/me").send({ coverUploadId: avatar.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const me = await as(alice).patch("/api/users/me").send({ avatarUploadId: avatar.uploadId }).expect(200);
    expect(me.body.avatarUrl).toEqual(expect.any(String));
    const p = await as(alice).post("/api/posts").send({ body: "", mediaIds: [post.uploadId] }).expect(201);
    expect(p.body.media.map((m: { id: string }) => m.id)).toEqual([post.uploadId]);
    // A post upload is used once.
    expect((await as(alice).post("/api/posts").send({ body: "again", mediaIds: [post.uploadId] }).expect(400)).body.code).toBe("MEDIA_IN_USE");
  });

  test("an upload that has not finished cannot be attached", async () => {
    const u = await createUser();
    const created = await as(u).post("/api/media/uploads").send({ purpose: "POST", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length }).expect(201);
    expect((await as(u).post("/api/posts").send({ body: "x", mediaIds: [created.body.uploadId] }).expect(400)).body.code).toBe("MEDIA_NOT_READY");
  });

  test("a comment carries one image", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const p = await as(alice).post("/api/posts").send({ body: "Post" }).expect(201);
    const img = await upload(bob, "COMMENT", "r.png", "image/png", TINY_PNG);
    const c = await as(bob).post(`/api/posts/${p.body.id}/comments`).send({ body: "", mediaId: img.uploadId }).expect(201);
    expect(c.body.media?.id).toBe(img.uploadId);
    expect((await as(bob).post(`/api/posts/${p.body.id}/comments`).send({ body: "", mediaId: img.uploadId }).expect(400)).body.code).toBe("MEDIA_IN_USE");
    await anon().get(`/api/media/${img.uploadId}`).expect(200);
  });
});

describe("who can read an upload", () => {
  test("an unattached upload is the owner's (and staff's) only", async () => {
    const [u, other] = [await createUser(), await createUser()];
    const { uploadId } = await upload(u, "POST", "a.png", "image/png", TINY_PNG);
    await as(u).get(`/api/media/${uploadId}`).expect(200);
    await as(other).get(`/api/media/${uploadId}`).expect(404);
    await anon().get(`/api/media/${uploadId}`).expect(404);
    await as(await createUser({ role: "MODERATOR" })).get(`/api/media/${uploadId}`).expect(200);
  });

  test("post media follows the post: CONNECTIONS-only and blocks", async () => {
    const [a, friend, stranger] = [await createUser(), await createUser(), await createUser()];
    await connect(a, friend);
    const { uploadId } = await upload(a, "POST", "a.png", "image/png", TINY_PNG);
    await as(a).post("/api/posts").send({ body: "friends only", visibility: "CONNECTIONS", mediaIds: [uploadId] }).expect(201);
    await as(friend).get(`/api/media/${uploadId}`).expect(200);
    await as(stranger).get(`/api/media/${uploadId}`).expect(404);
    await anon().get(`/api/media/${uploadId}`).expect(404);
    await block(friend, a);
    await as(friend).get(`/api/media/${uploadId}`).expect(404);
  });

  test("DM media: the two participants only", async () => {
    const [a, b, outsider] = [await createUser(), await createUser(), await createUser()];
    await connect(a, b);
    const { uploadId } = await upload(a, "DM", "notes.pdf", "application/pdf", TINY_PDF);
    const t = await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200);
    await as(a).post(`/api/dms/threads/${t.body.id}/messages`).send({ mediaIds: [uploadId] }).expect(201);
    await as(b).get(`/api/media/${uploadId}`).expect(200);
    await as(outsider).get(`/api/media/${uploadId}`).expect(404);
    await anon().get(`/api/media/${uploadId}`).expect(404);
  });

  test("an avatar is public; a published project's cover is public; a draft's is not", async () => {
    const u = await createUser();
    const avatar = await upload(u, "AVATAR", "me.png", "image/png", TINY_PNG);
    await as(u).patch("/api/users/me").send({ avatarUploadId: avatar.uploadId }).expect(200);
    await anon().get(`/api/media/${avatar.uploadId}`).expect(200);

    const published = await makeProfile();
    const pub = await upload(published, "PROJECT_COVER", "c.png", "image/png", TINY_PNG);
    await as(published).put("/api/profiles/me/sections/projects").send({ items: [{ name: "Shown", coverUploadId: pub.uploadId }] }).expect(200);
    await anon().get(`/api/media/${pub.uploadId}`).expect(200);

    const draft = await makeProfile({ status: "DRAFT" });
    const hidden = await upload(draft, "PROJECT_COVER", "c.png", "image/png", TINY_PNG);
    await as(draft).put("/api/profiles/me/sections/projects").send({ items: [{ name: "Hidden", coverUploadId: hidden.uploadId }] }).expect(200);
    await anon().get(`/api/media/${hidden.uploadId}`).expect(404);
  });

  test("a resume sent with an application: the hiring team only, until the candidate withdraws", async () => {
    const poster = await makeCompanyRecruiter();
    const otherCo = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const resume = await upload(cand, "RESUME", "cv.pdf", "application/pdf", TINY_PDF);
    const job = await makeJob(poster);
    const app = await apply(cand, job.id, { resumeUploadId: resume.uploadId });
    await as(poster).get(`/api/media/${resume.uploadId}`).expect(200);
    await as(otherCo).get(`/api/media/${resume.uploadId}`).expect(404);
    await anon().get(`/api/media/${resume.uploadId}`).expect(404);
    await as(cand).get(`/api/media/${resume.uploadId}`).expect(200);
    await as(cand).post(`/api/applications/${app.id}/withdraw`).expect(200);
    await as(poster).get(`/api/media/${resume.uploadId}`).expect(404);

    // Someone else's resume cannot be sent.
    const mallory = await makeProfile();
    const job2 = await makeJob(poster);
    expect((await as(mallory).post(`/api/jobs/${job2.id}/apply`).send({ resumeUploadId: resume.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
  });
});

describe("local signed links", () => {
  test.skipIf(S3)("served with nosniff; documents download as attachments; tampered tokens fail", async () => {
    const u = await createUser();
    const { res } = await upload(u, "POST", "notes.pdf", "application/pdf", TINY_PDF);
    const got = await getUrl(res.body.url);
    expect(got.status).toBe(200);
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-disposition"]).toMatch(/^attachment/);
    const img = await upload(u, "POST", "a.png", "image/png", TINY_PNG);
    expect((await getUrl(img.res.body.url)).headers["content-disposition"]).toBe("inline");
    const tampered = res.body.url.replace(/.$/, (c: string) => (c === "A" ? "B" : "A"));
    expect((await getUrl(tampered)).status).toBe(403);
  });
});

describe("expiry", () => {
  test("old pending and never-attached uploads are deleted; attached ones stay", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await connect(a, b);
    const old = new Date(Date.now() - 72 * 3600_000);
    const pending = await as(a).post("/api/media/uploads").send({ purpose: "POST", fileName: "p.png", mimeType: "image/png", sizeBytes: 10 }).expect(201);
    const unattached = await upload(a, "POST", "u.png", "image/png", TINY_PNG);
    const attached = await upload(a, "DM", "d.png", "image/png", TINY_PNG);
    const t = await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200);
    await as(a).post(`/api/dms/threads/${t.body.id}/messages`).send({ mediaIds: [attached.uploadId] }).expect(201);
    const ids = [pending.body.uploadId, unattached.uploadId, attached.uploadId];
    await db.updateTable("media_uploads").set({ created_at: old }).where("id", "in", ids).execute();
    await expireUploads();
    const left = await db.selectFrom("media_uploads").select("id").where("id", "in", ids).execute();
    expect(left.map((r) => r.id)).toEqual([attached.uploadId]);
  });
});
