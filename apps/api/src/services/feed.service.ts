/**
 * Every list of posts: the home feed, profile activity, company page posts and
 * bookmarks. All of them read through postRepo.visible(), so blocks and
 * CONNECTIONS-only visibility apply everywhere.
 *
 * Home feed: your network (see post.repository.ts). When the network has fewer than a
 * page of posts on the first page, suggested public posts fill the rest, flagged by id
 * so the client can label them; "top" ranks the last seven days by reactions + 2 *
 * comments with a (score, id) cursor.
 */
import type { Post } from "@open-talent/types";
import type { Actor } from "../core/context";
import { presentPosts } from "../presenters/post.presenter";
import { decodeScore, decodeTime, encodeScore, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { postRepo, type ListedPost } from "../repositories/post.repository";

export interface PageQuery {
  cursor?: string;
  limit: number;
}

async function present(viewer: Actor | null, page: Paged<ListedPost>): Promise<Paged<Post>> {
  return { items: await presentPosts(viewer, page.items), nextCursor: page.nextCursor };
}

const byTime = (rows: ListedPost[], limit: number) => pageBy(rows, limit, (r) => encodeTime(r._at, r.id));
const byScore = (rows: ListedPost[], limit: number) => pageBy(rows, limit, (r) => encodeScore(Number(r._score ?? 0), r.id));

export async function homeFeed(actor: Actor, q: PageQuery & { sort: "latest" | "top" }): Promise<Paged<Post> & { suggestedIds: string[] }> {
  const page =
    q.sort === "latest"
      ? byTime(await postRepo.homeFeed(actor, { sort: "latest", time: decodeTime(q.cursor), score: null, limit: q.limit }), q.limit)
      : byScore(await postRepo.homeFeed(actor, { sort: "top", time: null, score: decodeScore(q.cursor), limit: q.limit }), q.limit);
  let suggested: ListedPost[] = [];
  if (!q.cursor && page.items.length < q.limit) {
    const have = new Set(page.items.map((p) => p.id));
    suggested = (await postRepo.suggested(actor, q.limit)).filter((p) => !have.has(p.id)).slice(0, q.limit - page.items.length);
  }
  const items = await presentPosts(actor, [...page.items, ...suggested]);
  return { items, nextCursor: page.nextCursor, suggestedIds: suggested.map((p) => p.id) };
}

export async function authorPosts(viewer: Actor | null, authorId: string, q: PageQuery): Promise<Paged<Post>> {
  return present(viewer, byTime(await postRepo.byAuthor(viewer, authorId, decodeTime(q.cursor), q.limit), q.limit));
}

export async function companyPosts(viewer: Actor | null, companyId: string, q: PageQuery): Promise<Paged<Post>> {
  return present(viewer, byTime(await postRepo.byCompany(viewer, companyId, decodeTime(q.cursor), q.limit), q.limit));
}

export async function bookmarks(actor: Actor, q: PageQuery): Promise<Paged<Post>> {
  const rows = await postRepo.bookmarks(actor, decodeTime(q.cursor), q.limit);
  return present(actor, pageBy(rows, q.limit, (r) => encodeTime(r._bat, r.id)));
}
