/**
 * ArtworkIndexer: the background half of indexing one artwork, as a Workflow so
 * each slow, failure-prone call (vision description, embedding, vector upsert)
 * is a durable step with its own retries. The steps live in store.ts
 * (`indexOps`); the order lives in indexing.ts (`runIndexing`), shared with the
 * inline path local dev uses.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runIndexing, type DoStep, type IndexParams } from "./indexing";
import { indexOps, type Env } from "./store";

export class ArtworkIndexer extends WorkflowEntrypoint<Env, IndexParams> {
  async run(event: Readonly<WorkflowEvent<IndexParams>>, step: WorkflowStep) {
    // every step returns plain JSON (booleans, strings, number[]), as step.do requires
    const doStep: DoStep = (name, config, fn) => step.do(name, config, fn as () => Promise<never>);
    return runIndexing(event.payload, indexOps(this.env, event.payload.artworkId), doStep);
  }
}
