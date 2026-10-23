/**
 * The Socket.IO gateway: the only place that touches Socket.IO in the API process.
 *
 *   - Auth: the access token in `handshake.auth.token`, checked by the same function as
 *     HTTP (actorFromToken). A rejected connection gets an Error whose message is the
 *     failure code (MISSING, INVALID, BANNED, DEACTIVATED).
 *   - Rooms: every socket joins user:<id> (and "staff" for staff). Clients never name a
 *     room; they ask to subscribe and the server checks the same rule the REST read uses.
 *   - Fan-out: the Redis adapter, so an emit on any API task (or the worker's emitter)
 *     reaches sockets on every task.
 *   - Revocation: every few minutes each socket's user is re-read; a ban, deactivation or
 *     "sign out everywhere" (token_version bump) disconnects it even before the token
 *     expires. Suspensions, bans, sign-out everywhere and password changes also
 *     disconnect at once through disconnectUsers(). Losing access to a room (a block
 *     ending a conversation, removal from a company team) takes the user's sockets out
 *     of it at once through leaveRooms().
 *   - Abuse limits: at most MAX_SOCKETS_PER_USER live sockets per user (the next one is
 *     refused with TOO_MANY_CONNECTIONS), and each socket may send at most
 *     REQUEST_LIMIT subscribe or presence requests per REQUEST_WINDOW_MS (RATE_LIMITED).
 *   - Presence: a query answers only for people the viewer could know about (a
 *     connection, a follow either way, or a shared DM thread), never across a block.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Ack, ClientToServerEvents, ServerToClientEvents } from "@open-talent/types";
import { createAdapter } from "@socket.io/redis-adapter";
import { sql } from "kysely";
import { Server, type Socket } from "socket.io";
import { allowedOrigins } from "../core/config";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { isId } from "../core/ids";
import { captureError } from "../core/logger";
import { db } from "../db/kysely";
import { newRedisClient } from "../integrations/redis";
import { actorFromToken } from "../middleware/auth";
import { dmRepo } from "../repositories/dm.repository";
import { userRepo } from "../repositories/user.repository";
import { blockedSet, canReadPost, notBlocked } from "../repositories/visibility";
import { verifyAccessToken } from "../security/tokens";
import { rooms, setRealtimeTransport, type RealtimeTransport } from "./port";
import { HEARTBEAT_MS, heartbeat, liveSocketCount, markOffline, markOnline, onlineMap } from "./presence";

export interface Gateway {
  close(): Promise<void>;
  /** The underlying server, for tests. */
  readonly io: Server<ClientToServerEvents, ServerToClientEvents>;
}

export interface GatewayOptions {
  /** How often each socket's user is re-validated. Default 5 minutes. */
  revalidateMs?: number;
  /** Presence heartbeat interval. Default 30 seconds. */
  heartbeatMs?: number;
  /** Install this gateway as the realtime transport (default true). */
  installTransport?: boolean;
  /** Live sockets allowed per user across every task. Default MAX_SOCKETS_PER_USER. */
  maxSocketsPerUser?: number;
}

interface SocketData {
  actor: Actor;
  tokenVersion: number;
  typingAt: Map<string, number>;
  requests: { windowStart: number; count: number };
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const PRESENCE_FANOUT_CAP = 200;
const TYPING_THROTTLE_MS = 2_000;
const PRESENCE_QUERY_MAX = 100;
export const MAX_SOCKETS_PER_USER = 20;
/** Subscribe and presence requests a socket may send per window. */
export const REQUEST_LIMIT = 30;
export const REQUEST_WINDOW_MS = 10_000;

function respond(ack: unknown, res: Parameters<Ack<any>>[0]): void {
  if (typeof ack === "function") (ack as Ack<any>)(res);
}

const refused = (code: string, error = "Not allowed") => ({ ok: false as const, code, error });

/** People who should see this user's online status: connections and DM counterparts, minus blocks. */
async function presenceAudience(userId: string): Promise<string[]> {
  const [threadContacts, connections, blocked] = await Promise.all([
    dmRepo.threadContacts(userId, PRESENCE_FANOUT_CAP),
    sql<{ uid: string }>`SELECT CASE WHEN requester_id = ${userId} THEN addressee_id ELSE requester_id END AS uid FROM connections
                          WHERE status = 'ACCEPTED' AND (requester_id = ${userId} OR addressee_id = ${userId}) LIMIT ${PRESENCE_FANOUT_CAP}`.execute(db),
    blockedSet(userId),
  ]);
  const all = new Set([...threadContacts, ...connections.rows.map((c) => c.uid)]);
  return [...all].filter((id) => !blocked.has(id)).slice(0, PRESENCE_FANOUT_CAP);
}

async function announcePresence(io: AppServer, userId: string, online: boolean, lastSeenAt: Date | null): Promise<void> {
  const audience = await presenceAudience(userId);
  if (audience.length) io.to(audience.map(rooms.user)).emit("presence:update", { userId, online, lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null });
}

// ─── Subscription rules (the same ones the REST reads apply) ────────────────

/** The pipeline board of a job: ACTIVE recruiters of its company only. */
async function canSubscribeJob(actor: Actor, jobId: string): Promise<boolean> {
  const row = await db
    .selectFrom("jobs as j")
    .innerJoin("recruiters as r", (j) => j.onRef("r.company_id", "=", "j.company_id").on("r.user_id", "=", actor.id).on("r.status", "=", "ACTIVE"))
    .select("j.id")
    .where("j.id", "=", jobId)
    .executeTakeFirst();
  return !!row;
}

async function canSubscribePost(actor: Actor, postId: string): Promise<boolean> {
  const row = await db
    .selectFrom("posts as p")
    .select("p.id")
    .where("p.id", "=", postId)
    .where("p.status", "=", "PUBLISHED")
    .where(canReadPost(actor, "p"))
    .where(notBlocked(actor.id, "p.author_id"))
    .executeTakeFirst();
  return !!row;
}

/**
 * Of `ids`, the people `viewerId` could know about: they are connected, follow each
 * other in either direction, or share a DM thread (both ACTIVE in it). Blocks either way
 * exclude.
 */
async function knownPeople(viewerId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await sql<{ id: string }>`
    SELECT u.id FROM users u
     WHERE u.id = ANY(${ids}::text[]) AND u.id <> ${viewerId}
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = u.id) OR (b.blocked_id = ${viewerId} AND b.blocker_id = u.id))
       AND (
         EXISTS (SELECT 1 FROM follows f WHERE (f.follower_id = ${viewerId} AND f.followee_id = u.id) OR (f.followee_id = ${viewerId} AND f.follower_id = u.id))
         OR EXISTS (
           SELECT 1 FROM connections k WHERE k.status = 'ACCEPTED'
              AND ((k.requester_id = ${viewerId} AND k.addressee_id = u.id) OR (k.addressee_id = ${viewerId} AND k.requester_id = u.id)))
         OR EXISTS (
           SELECT 1 FROM dm_participants pa
             JOIN dm_participants pb ON pb.thread_id = pa.thread_id AND pb.user_id = u.id AND pb.state = 'ACTIVE'
            WHERE pa.user_id = ${viewerId} AND pa.state = 'ACTIVE')
       )`.execute(db);
  return new Set(rows.map((r) => r.id));
}

async function threadParticipants(threadId: string) {
  return (await dmRepo.participants([threadId])).filter((p) => p.state === "ACTIVE" || p.state === "REQUESTED");
}

// ─── Gateway ────────────────────────────────────────────────────────────────

export async function startGateway(server: http.Server, opts: GatewayOptions = {}): Promise<Gateway> {
  const io: AppServer = new Server(server, {
    path: "/socket.io",
    // Accept /socket.io?EIO=... as well as /socket.io/?EIO=...: the web app's dev proxy
    // (Next rewrites) drops the trailing slash before forwarding, so without this every
    // handshake through http://localhost:<web> was a 404 and realtime never connected.
    addTrailingSlash: false,
    serveClient: false,
    cors: { origin: allowedOrigins(), credentials: true },
  });
  const pub = newRedisClient();
  const sub = newRedisClient();
  io.adapter(createAdapter(pub, sub));

  // Presence work still running when we close must finish before Redis goes away.
  const inFlight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => {
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
    return p;
  };

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      const result = await actorFromToken(typeof token === "string" ? token : null);
      if ("failure" in result) return next(new Error(result.failure));
      // Counted from presence (every task's live sockets), so the cap holds cluster-wide.
      if ((await liveSocketCount(result.actor.id)) >= (opts.maxSocketsPerUser ?? MAX_SOCKETS_PER_USER)) return next(new Error("TOO_MANY_CONNECTIONS"));
      socket.data.actor = result.actor;
      socket.data.tokenVersion = verifyAccessToken(token as string)?.ver ?? -1;
      socket.data.typingAt = new Map();
      socket.data.requests = { windowStart: Date.now(), count: 0 };
      next();
    } catch (err) {
      captureError(err, { where: "gateway.auth" });
      next(new Error("INTERNAL"));
    }
  });

  io.on("connection", (socket: AppSocket) => {
    const actor = socket.data.actor;
    void socket.join(rooms.user(actor.id));
    if (isStaff(actor)) void socket.join(rooms.staff);

    const registered = track(
      markOnline(actor.id, socket.id)
        .then((flipped) => (flipped ? announcePresence(io, actor.id, true, null) : undefined))
        .catch((err) => captureError(err, { where: "gateway.presence.online" })),
    );

    socket.on("disconnect", () => {
      // After the connect bookkeeping, or a quick connect/disconnect leaves a stale entry.
      void track(
        registered
          .then(() => markOffline(actor.id, socket.id))
          .then(async (flipped) => {
            if (!flipped) return;
            const now = new Date();
            await userRepo.touchLastSeen(actor.id);
            await announcePresence(io, actor.id, false, now);
          })
          .catch((err) => captureError(err, { where: "gateway.presence.offline" })),
      );
    });

    const guarded =
      <A extends unknown[]>(name: string, fn: (...args: A) => Promise<void>) =>
      (...args: A): Promise<void> =>
        fn(...args).catch((err) => {
          captureError(err, { where: `gateway.${name}` });
          respond(args[args.length - 1], refused("INTERNAL", "Something went wrong"));
        });

    /** Per-socket budget for requests that run a query (subscribes, presence). Fixed window. */
    const overBudget = (): boolean => {
      const now = Date.now();
      const r = socket.data.requests;
      if (now - r.windowStart >= REQUEST_WINDOW_MS) {
        r.windowStart = now;
        r.count = 0;
      }
      r.count += 1;
      return r.count > REQUEST_LIMIT;
    };

    /** guarded() plus the request budget: over it, the ack says RATE_LIMITED and nothing runs. */
    const limited =
      <A extends unknown[]>(name: string, fn: (...args: A) => Promise<void>) =>
      (...args: A): Promise<void> => {
        if (overBudget()) {
          respond(args[args.length - 1], refused("RATE_LIMITED", "Too many requests, slow down"));
          return Promise.resolve();
        }
        return guarded(name, fn)(...args);
      };

    socket.on(
      "job:subscribe",
      limited("job:subscribe", async (p, ack) => {
        const id = p?.jobId;
        if (!isId(id)) return respond(ack, refused("VALIDATION_FAILED", "jobId is required"));
        if (!(await canSubscribeJob(socket.data.actor, id))) return respond(ack, refused("NOT_FOUND", "Job not found"));
        await socket.join(rooms.job(id));
        respond(ack, { ok: true });
      }),
    );
    socket.on("job:unsubscribe", (p) => {
      if (isId(p?.jobId)) void socket.leave(rooms.job(p.jobId));
    });

    socket.on(
      "post:subscribe",
      limited("post:subscribe", async (p, ack) => {
        const id = p?.postId;
        if (!isId(id)) return respond(ack, refused("VALIDATION_FAILED", "postId is required"));
        if (!(await canSubscribePost(socket.data.actor, id))) return respond(ack, refused("NOT_FOUND", "Post not found"));
        await socket.join(rooms.post(id));
        respond(ack, { ok: true });
      }),
    );
    socket.on("post:unsubscribe", (p) => {
      if (isId(p?.postId)) void socket.leave(rooms.post(p.postId));
    });

    socket.on(
      "thread:subscribe",
      limited("thread:subscribe", async (p, ack) => {
        const id = p?.threadId;
        if (!isId(id)) return respond(ack, refused("VALIDATION_FAILED", "threadId is required"));
        const members = await threadParticipants(id);
        if (!members.some((m) => m.user_id === socket.data.actor.id)) return respond(ack, refused("NOT_FOUND", "Conversation not found"));
        await socket.join(rooms.thread(id));
        respond(ack, { ok: true });
      }),
    );
    socket.on("thread:unsubscribe", (p) => {
      if (isId(p?.threadId)) void socket.leave(rooms.thread(p.threadId));
    });

    /** Typing relays are throttled per socket and target; "stopped typing" always goes through. */
    const throttled = (key: string, typing: boolean): boolean => {
      if (!typing) {
        socket.data.typingAt.delete(key);
        return false;
      }
      const now = Date.now();
      const last = socket.data.typingAt.get(key) ?? 0;
      if (now - last < TYPING_THROTTLE_MS) return true;
      socket.data.typingAt.set(key, now);
      return false;
    };

    // Typing events are handled in arrival order per socket, so "stopped" never overtakes "started".
    let typingChain: Promise<unknown> = Promise.resolve();
    const inOrder =
      <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
      (...args: A) => {
        typingChain = typingChain.then(() => fn(...args));
      };

    socket.on(
      "dm:typing",
      inOrder(guarded("dm:typing", async (p) => {
        const id = p?.threadId;
        const typing = !!p?.typing;
        if (!isId(id) || throttled(`dm:${id}`, typing)) return;
        const me = socket.data.actor;
        const members = await threadParticipants(id);
        if (!members.some((m) => m.user_id === me.id)) return;
        const blocked = await blockedSet(me.id);
        const targets = members.filter((m) => m.user_id !== me.id && !blocked.has(m.user_id)).map((m) => rooms.user(m.user_id));
        if (targets.length) io.to(targets).emit("dm:typing", { threadId: id, userId: me.id, typing });
      })),
    );

    socket.on(
      "presence:query",
      limited("presence:query", async (p, ack) => {
        const ids = Array.isArray(p?.userIds) ? [...new Set(p.userIds.filter(isId))].slice(0, PRESENCE_QUERY_MAX) : [];
        // People the viewer could not know about are omitted, not reported offline.
        const known = await knownPeople(socket.data.actor.id, ids);
        const visible = ids.filter((id) => known.has(id));
        const online = await onlineMap(visible);
        respond(ack, { ok: true, data: Object.fromEntries(visible.map((id) => [id, !!online.get(id)])) });
      }),
    );
  });

  const localSockets = () => [...io.of("/").sockets.values()] as AppSocket[];

  const beat = setInterval(() => {
    heartbeat(localSockets().map((s) => ({ userId: s.data.actor.id, socketId: s.id }))).catch((err) => captureError(err, { where: "gateway.heartbeat" }));
  }, opts.heartbeatMs ?? HEARTBEAT_MS);
  beat.unref();

  const revalidate = setInterval(() => {
    void revalidateSockets(localSockets()).catch((err) => captureError(err, { where: "gateway.revalidate" }));
  }, opts.revalidateMs ?? 5 * 60_000);
  revalidate.unref();

  const transport: RealtimeTransport = {
    emit(targets, event, payload) {
      (io.to(targets).emit as (e: string, p: unknown) => boolean)(event, payload);
    },
    disconnectUsers(userIds, reason) {
      const targets = userIds.map(rooms.user);
      io.to(targets).emit("session:revoked", { reason });
      io.in(targets).disconnectSockets(true);
    },
    leaveRooms(userIds, leave) {
      io.in(userIds.map(rooms.user)).socketsLeave(leave);
    },
  };
  if (opts.installTransport !== false) setRealtimeTransport(transport);

  return {
    io: io as unknown as Gateway["io"],
    async close() {
      clearInterval(beat);
      clearInterval(revalidate);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      while (inFlight.size) await Promise.allSettled([...inFlight]);
      await Promise.all([pub.quit().catch(() => undefined), sub.quit().catch(() => undefined)]);
      if (opts.installTransport !== false) setRealtimeTransport(null);
    },
  };
}

/** Re-read each socket's user: ban, deactivation or a token_version bump ends the socket. */
async function revalidateSockets(sockets: AppSocket[]): Promise<void> {
  const ids = [...new Set(sockets.map((s) => s.data.actor.id))];
  if (!ids.length) return;
  const users = await db.selectFrom("users").select(["id", "status", "token_version", "suspended_until"]).where("id", "in", ids).execute();
  const byId = new Map(users.map((u) => [u.id, u]));
  for (const s of sockets) {
    const u = byId.get(s.data.actor.id);
    const reason = !u ? "SIGNED_OUT" : u.status === "BANNED" ? "BANNED" : u.status === "DEACTIVATED" || u.token_version !== s.data.tokenVersion ? "SIGNED_OUT" : null;
    if (reason) {
      s.emit("session:revoked", { reason });
      s.disconnect(true);
      continue;
    }
    const suspended = u!.status === "SUSPENDED" && !(u!.suspended_until && u!.suspended_until <= new Date());
    s.data.actor = { ...s.data.actor, status: suspended ? "SUSPENDED" : u!.status === "PENDING_VERIFICATION" ? "PENDING_VERIFICATION" : "ACTIVE" };
  }
}

/**
 * Test helper: an HTTP server with the gateway on an ephemeral port.
 *
 *   const srv = await listenWithGateway(createApp(), { revalidateMs: 200 });
 *   const socket = io(srv.url, { path: "/socket.io", auth: { token } });
 */
export async function listenWithGateway(
  handler: http.RequestListener | undefined,
  opts: GatewayOptions = {},
): Promise<{ url: string; server: http.Server; gateway: Gateway; close(): Promise<void> }> {
  const server = http.createServer(handler);
  const gateway = await startGateway(server, opts);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    gateway,
    close: () => gateway.close(),
  };
}
