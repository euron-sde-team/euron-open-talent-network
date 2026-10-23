/**
 * Blocks. A block ends every relationship between the two people in the same
 * transaction: follows both ways and the connection (with their counters), any live
 * contact unlock either way, and pending approaches between them (marked BLOCKED).
 */
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { pairKey } from "../domain/can-message";
import { followRepo } from "./follow.repository";

export class BlockRepository {
  async block(blockerId: string, blockedId: string, exec: Executor): Promise<void> {
    await exec
      .insertInto("blocks")
      .values({ blocker_id: blockerId, blocked_id: blockedId, created_at: new Date() })
      .onConflict((oc) => oc.columns(["blocker_id", "blocked_id"]).doNothing())
      .execute();
    await followRepo.unfollow(blockerId, blockedId, exec);
    await followRepo.unfollow(blockedId, blockerId, exec);

    const conn = await exec.deleteFrom("connections").where("pair_key", "=", pairKey(blockerId, blockedId)).returning("status").executeTakeFirst();
    if (conn?.status === "ACCEPTED") {
      await exec.updateTable("users").set({ connection_count: sql`greatest(0, connection_count - 1)` }).where("id", "in", [blockerId, blockedId]).execute();
    }

    const now = new Date();
    // Approaches and unlocks either way (each side may be the recruiter).
    const recruiterRows = await exec.selectFrom("recruiters").select(["id", "user_id"]).where("user_id", "in", [blockerId, blockedId]).execute();
    for (const r of recruiterRows) {
      const candidate = r.user_id === blockerId ? blockedId : blockerId;
      await exec.updateTable("approaches").set({ status: "BLOCKED", responded_at: now }).where("recruiter_id", "=", r.id).where("candidate_id", "=", candidate).where("status", "=", "PENDING").execute();
      await exec.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Blocked" }).where("recruiter_id", "=", r.id).where("candidate_id", "=", candidate).where("revoked_at", "is", null).execute();
    }
  }

  unblock(blockerId: string, blockedId: string, exec: Executor = db) {
    return exec.deleteFrom("blocks").where("blocker_id", "=", blockerId).where("blocked_id", "=", blockedId).execute();
  }

  /** People the user has blocked (not people who blocked them: that stays private). */
  blockedBy(userId: string, exec: Executor = db) {
    return exec
      .selectFrom("blocks")
      .select("blocked_id")
      .where("blocker_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(500)
      .execute()
      .then((rows) => rows.map((r) => r.blocked_id));
  }
}

export const blockRepo = new BlockRepository();
