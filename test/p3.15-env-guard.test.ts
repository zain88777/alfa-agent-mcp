import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

describe("P3.15 env centralization + guard", () => {
  it("env guard passes with current allowlist", () => {
    const run = spawnSync(process.execPath, ["scripts/check-env-reads.mjs"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout || "env guard failed");
  });

  it("approved exceptions are documented", () => {
    const raw = readFileSync("scripts/env-read-allowlist.json", "utf8");
    const items = JSON.parse(raw) as Array<{ path: string; reason: string }>;
    assert.ok(Array.isArray(items));
    assert.ok(items.length >= 2);
    assert.equal(items.every((x) => typeof x.path === "string" && x.path.length > 0 && typeof x.reason === "string" && x.reason.length > 0), true);
    assert.ok(items.some((x) => x.path === "src/core/runtimeConfig.ts"));
  });

  it("runtimeConfig remains the only normal runtime env reader", () => {
    const run = spawnSync(process.execPath, ["scripts/report-env-debt.mjs"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout || "env debt report failed");
    const parsed = JSON.parse(run.stdout || "{}");
    assert.equal(Array.isArray(parsed.debt), true);
    assert.equal(parsed.debt.length, 0);
  });

  it("env debt report is actionable", () => {
    const run = spawnSync(process.execPath, ["scripts/report-env-debt.mjs"], { encoding: "utf8" });
    assert.equal(run.status, 0);
    const parsed = JSON.parse(run.stdout || "{}");
    assert.equal(typeof parsed.count, "number");
    assert.equal(Array.isArray(parsed.allowlist), true);
    assert.equal(Array.isArray(parsed.debt), true);
  });
});
