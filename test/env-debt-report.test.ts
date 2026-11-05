import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

describe("P3.14 env-read debt report", () => {
  it("reports remaining direct process.env reads outside runtimeConfig", () => {
    const run = spawnSync(process.execPath, ["scripts/report-env-debt.mjs"], {
      encoding: "utf8",
    });

    assert.equal(run.status, 0, run.stderr || "env debt script failed");
    const parsed = JSON.parse(run.stdout || "{}");
    assert.equal(typeof parsed.count, "number");
    assert.equal(Array.isArray(parsed.allowlist), true);
    assert.equal(Array.isArray(parsed.debt), true);
  });
});
