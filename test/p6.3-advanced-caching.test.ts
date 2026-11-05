import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CacheEngine } from "../src/core/cacheEngine.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { PolicyEngine, PolicyTier } from "../src/core/policyEngine.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";
import { metricsSnapshotToolHandler } from "../src/tools/metricsSnapshot.js";

function makeRegistryWithPolicy(policyEntries: Array<[string, { tier: PolicyTier; defaultAllow?: boolean; requiresApproval?: boolean }]>): ToolRegistry {
  return new ToolRegistry(new PolicyEngine(new Map(policyEntries)), new ApprovalEngine());
}

describe("P6.3 Advanced Caching Strategy", () => {
  beforeEach(() => {
    // reset through registry API path in each test by creating fresh registry.
  });

  it("cache hit and miss behavior for deterministic read-only tool", async () => {
    const reg = makeRegistryWithPolicy([
      ["project_tree", { tier: PolicyTier.READ_ONLY, defaultAllow: true }],
    ]);
    let calls = 0;
    reg.register("project_tree", async () => {
      calls++;
      return { value: "tree", calls };
    });

    const a = await reg.execute("project_tree", { directory: "." }, "req-cache-hit-1");
    const b = await reg.execute("project_tree", { directory: "." }, "req-cache-hit-2");
    assert.equal((a as { value: string }).value, "tree");
    assert.equal((b as { value: string }).value, "tree");
    assert.equal(calls, 1);
  });

  it("no mutation-tool caching", async () => {
    const reg = makeRegistryWithPolicy([
      ["write_file", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
    ]);
    let calls = 0;
    reg.register("write_file", async () => {
      calls++;
      return { ok: true, calls };
    });

    await reg.execute("write_file", { filePath: "a.txt", content: "x" }, "req-mutation-no-cache-1");
    await reg.execute("write_file", { filePath: "a.txt", content: "x" }, "req-mutation-no-cache-2");
    assert.equal(calls, 2);
  });

  it("TTL expiration works", async () => {
    const cache = new CacheEngine(10, 20);
    const key = cache.makeKey("project_tree", { directory: "." }, "ws-a");
    cache.set(key, { ok: 1 }, "project_tree", "ws-a");
    assert.deepEqual(cache.get(key), { ok: 1 });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(cache.get(key), undefined);
  });

  it("bounded eviction (LRU) works", () => {
    const cache = new CacheEngine(2, 10_000);
    cache.set(cache.makeKey("t1", { a: 1 }, "ws"), { a: 1 }, "t1", "ws");
    cache.set(cache.makeKey("t2", { b: 2 }, "ws"), { b: 2 }, "t2", "ws");
    cache.set(cache.makeKey("t3", { c: 3 }, "ws"), { c: 3 }, "t3", "ws");
    const snap = cache.snapshot();
    assert.equal(snap.entries, 2);
    assert.ok(snap.metrics.evictions >= 1);
  });

  it("invalidation after mutation clears cached read-only output", async () => {
    const reg = makeRegistryWithPolicy([
      ["project_tree", { tier: PolicyTier.READ_ONLY, defaultAllow: true }],
      ["write_file", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
    ]);
    let readCalls = 0;
    reg.register("project_tree", async () => ({ seq: ++readCalls }));
    reg.register("write_file", async () => ({ ok: true }));

    const first = await reg.execute("project_tree", { directory: "." }, "req-inv-1") as { seq: number };
    const second = await reg.execute("project_tree", { directory: "." }, "req-inv-2") as { seq: number };
    assert.equal(first.seq, second.seq);

    await reg.execute("write_file", { filePath: "x.txt", content: "1" }, "req-inv-3");

    const third = await reg.execute("project_tree", { directory: "." }, "req-inv-4") as { seq: number };
    assert.equal(third.seq, first.seq + 1);
  });

  it("workspace isolation in cache keys", () => {
    const cache = new CacheEngine(20, 10_000);
    const k1 = cache.makeKey("project_tree", { directory: "." }, "ws-1");
    const k2 = cache.makeKey("project_tree", { directory: "." }, "ws-2");
    assert.notEqual(k1, k2);
  });

  it("no secret leakage in cache metadata", async () => {
    const reg = makeRegistryWithPolicy([
      ["project_tree", { tier: PolicyTier.READ_ONLY, defaultAllow: true }],
    ]);
    reg.register("project_tree", async () => ({ token: "test-token-placeholder", path: "C:\\Users\\TestUser\\x" }));
    await reg.execute("project_tree", { directory: ".", apiKey: "test-api-key-placeholder" }, "req-secret-cache");

    const out = await metricsSnapshotToolHandler({ includeProfiling: true });
    const dump = out.content[0].text;
    assert.equal(dump.includes("test-api-key-placeholder"), false);
    assert.equal(dump.includes("test-token-placeholder"), false);
    assert.equal(dump.includes("C:\\Users\\TestUser"), false);
    assert.ok(dump.includes("\"cache\""));
  });
});

