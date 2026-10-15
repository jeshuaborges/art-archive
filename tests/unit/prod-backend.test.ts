import { describe, expect, it } from "vitest";
import { vectorBackend } from "../../worker/embed";

// Production uses Workers AI embeddings + Vectorize. These can't run offline,
// so verify the backend selection and the exact calls against fakes.
function fakes() {
  const calls: { ai: unknown[]; upsert: unknown[]; query: unknown[]; del: unknown[] } = { ai: [], upsert: [], query: [], del: [] };
  const AI = { run: async (model: string, input: { text: string[] }) => { calls.ai.push({ model, input }); return { shape: [input.text.length, 768], data: input.text.map((_, i) => Array(768).fill(i + 1)) }; } };
  const VECTORIZE = {
    upsert: async (v: unknown) => { calls.upsert.push(v); return { mutationId: "m" }; },
    query: async (vec: number[], opts: unknown) => { calls.query.push({ len: vec.length, opts }); return { count: 2, matches: [{ id: "a", score: 0.81 }, { id: "b", score: 0.5 }] }; },
    deleteByIds: async (ids: string[]) => { calls.del.push(ids); return { mutationId: "d" }; },
  };
  return { calls, env: { DB: {} as D1Database, AI: AI as unknown as Ai, VECTORIZE: VECTORIZE as unknown as VectorizeIndex, EMBEDDINGS: "workers-ai", EMBED_MODEL: "@cf/baai/bge-base-en-v1.5" } };
}

describe("production search backend", () => {
  it("is selected only when configured with both bindings", () => {
    const { env } = fakes();
    expect(vectorBackend(env).name).toBe("@cf/baai/bge-base-en-v1.5");
    expect(vectorBackend({ ...env, EMBEDDINGS: "local" }).name).toBe("local-hash-384");
    expect(vectorBackend({ ...env, VECTORIZE: undefined }).name).toBe("local-hash-384");
  });
  it("embeds with Workers AI and reads/writes Vectorize", async () => {
    const { env, calls } = fakes();
    const vb = vectorBackend(env);
    const [v] = await vb.embed(["warm sunset"]);
    expect(v).toHaveLength(768);
    expect(calls.ai[0]).toEqual({ model: "@cf/baai/bge-base-en-v1.5", input: { text: ["warm sunset"] } });
    await vb.upsert("a", v);
    expect(calls.upsert[0]).toEqual([{ id: "a", values: v }]);
    expect(await vb.query(v, 5)).toEqual([{ id: "a", score: 0.81 }, { id: "b", score: 0.5 }]);
    expect(calls.query[0]).toEqual({ len: 768, opts: { topK: 5 } });
    await vb.remove("a");
    expect(calls.del[0]).toEqual(["a"]);
    expect(vb.calibrate(0.85)).toBeCloseTo(1);
    expect(vb.calibrate(0.4)).toBe(0);
    expect(vb.calibrateSimilar(0.5)).toBe(0);
  });
});
