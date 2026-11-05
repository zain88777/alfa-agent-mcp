import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initSystem } from "../src/core/initSystem.js";
import { ErrorCode, ToolExecutionErrorClass } from "../src/core/errorResponse.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { PolicyEngine } from "../src/core/policyEngine.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";


describe("P3.14 Policy map completion + registry health hardening", () => {
  it("default runtime has zero unclassified tools and healthy status", () => {
    const { registry } = initSystem();
    const health = registry.getHealthSnapshot();
    assert.equal(health.unclassifiedTools, 0);
    assert.equal(health.status, "healthy");
  });

  it("every listDefinitions item includes policy metadata", () => {
    const { registry } = initSystem();
    const defs = registry.listDefinitions();
    assert.ok(defs.length > 0);
    assert.equal(defs.every((d) => d.policy !== undefined), true);
  });

  it("unknown tools remain deny-by-default", async () => {
    const { registry } = initSystem();
    await assert.rejects(
      () => registry.execute("unknown_future_tool", {}, "p314-unknown"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.POLICY_DENIED
    );
  });

  it("dangerous tools still require approval", async () => {
    const { registry } = initSystem();
    await assert.rejects(
      () => registry.execute("run_command", { commandId: "npm_test" }, "p314-danger"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.POLICY_DENIED
    );
  });

  it("system_sensitive tools still require approval", async () => {
    const { registry } = initSystem();
    await assert.rejects(
      () => registry.execute("env_scan", {}, "p314-system-sensitive"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.POLICY_DENIED
    );
  });

  it("registration without policy metadata fails health check", () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    reg.register("new_unclassified_tool", async () => ({ ok: true }));
    const health = reg.getHealthSnapshot();
    assert.equal(health.unclassifiedTools >= 1, true);
    assert.equal(health.status, "unhealthy");
  });

  it("metadata does not expose handlers", () => {
    const { registry } = initSystem();
    const defs = registry.listDefinitions();
    assert.equal(defs.every((d) => !("handler" in (d as object))), true);
  });
});
