/**
 * AssetChecker: reads originals back out of R2 in the background, a batch at a
 * time, as durable steps: their headers (format, bit depth, colour profile,
 * resolution) when unread, and a full re-read checked against the SHA-256
 * recorded at upload (fixity) when due. The work for one image is checkAsset in
 * store.ts; the nightly cron and POST /api/admin/check-assets queue batches.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { checkAsset, type AssetCheckParams, type Env } from "./store";

export class AssetChecker extends WorkflowEntrypoint<Env, AssetCheckParams> {
  async run(event: Readonly<WorkflowEvent<AssetCheckParams>>, step: WorkflowStep) {
    let checked = 0;
    for (const id of event.payload.imageIds) {
      await step.do(`check ${id}`, { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" },
        async () => JSON.parse(JSON.stringify(await checkAsset(this.env, id))));
      checked++;
    }
    return { checked };
  }
}
