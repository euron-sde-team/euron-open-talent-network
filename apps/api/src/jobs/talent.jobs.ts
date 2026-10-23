/**
 * Talent jobs:
 *
 *   import.run                        run an AI profile import (import.service.ts)
 *   feed.fanout                       tell the author's network a post exists
 *   maintenance.reconcile-counters    recompute every denormalised counter from the rows
 *   maintenance.talent-housekeeping   expire approaches, auto-complete engagements,
 *                                     reveal ratings, purge import input
 */
import { logger } from "../core/logger";
import { realtime, rooms } from "../realtime/port";
import { reconcileCounters } from "../services/counters.service";
import { runHousekeeping } from "../services/housekeeping.service";
import { run as runImport } from "../services/import.service";
import { fanOut } from "../services/post.service";
import { registerJob } from "./registry";

export function registerTalentJobs(): void {
  registerJob("import.run", ({ importId }) => runImport(importId));

  registerJob("feed.fanout", async ({ postId }) => {
    await fanOut(postId, (userIds, latestId) => realtime.emit(userIds.map(rooms.user), "feed:new-posts", { count: 1, latestId }));
  });

  registerJob("maintenance.reconcile-counters", async () => {
    const fixed = await reconcileCounters();
    const total = Object.values(fixed).reduce((a, b) => a + b, 0);
    if (total) logger.info({ fixed }, "counters reconciled");
  });

  registerJob("maintenance.talent-housekeeping", async () => {
    const done = await runHousekeeping();
    if (Object.values(done).some((n) => n > 0)) logger.info({ done }, "talent housekeeping");
  });
}
