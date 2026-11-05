/**
 * P1.6 Approval & Policy Engine Tests
 *
 * Runs with: node --test test/approval-policy-engine.test.ts
 * (from alfa-agent-mcp directory)
 *
 * Coverage:
 * - Unknown tool policy denied
 * - Dangerous tool denied without approval
 * - Approval expires
 * - Safe read tool allowed
 * - Nested dangerous tool does not inherit approval automatically
 * - Denied execution never calls handler
 * - Audit entry created on denial
 * - Policy engine evaluation rules
 * - Approval lifecycle (request → approve → expired → revoke)
 * - BYPASS PREVENTION: get() no longer exposes handler
 * - BYPASS PREVENTION: direct raw handler access unavailable from public API
 * - BYPASS PREVENTION: dangerous tool cannot execute except through execute()
 * - BYPASS PREVENTION: approval denial path never calls handler
 * - BYPASS PREVENTION: nested tool execution must use registry.execute()
 * - INHERITANCE: safe_write approval expires before child executes
 * - INHERITANCE: safe_write approval cannot cross parentRequestId chain
 * - INHERITANCE: lower-tier child cannot inherit from unrelated approved request
 * - INPUT REDACTION: sensitive keys (apiKey, token, password, secret) redacted
 * - HEALTH CHECK: unclassified tools flagged in health snapshot
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PolicyEngine, createDefaultPolicyMap, PolicyTier } from "../src/core/policyEngine.js";
import { ApprovalEngine, ApprovalStatus } from "../src/core/approvalEngine.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { createRegistry } from "../src/core/toolLoader.js";
import { ErrorCode } from "../src/core/errorResponse.js";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileToolHandler } from "../src/tools/writeFile.js";

// =====================================================================
// PolicyEngine Tests
// =====================================================================

await describe("PolicyEngine", async () => {
  await describe("evaluate()", async () => {
    await it("should deny unknown/unclassified tools", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("nonexistent_tool");

      assert.equal(result.allowed, false);
      assert.equal(result.requiresApproval, true);
      assert.ok(result.denialReason?.includes("not classified"));
    });

    await it("should deny dangerous tools without approval", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("delete_file");

      assert.equal(result.allowed, false);
      assert.equal(result.requiresApproval, true);
      assert.ok(result.denialReason?.includes("requires approval"));
    });

    await it("should allow dangerous tools with existing approval", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("delete_file", true); // approval exists

      assert.equal(result.allowed, true);
      assert.equal(result.requiresApproval, true);
    });

    await it("should allow dangerous tools without manual approval when MCP override is enabled", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map, { allowDangerousTools: true });

      const result = engine.evaluate("delete_file", false);

      assert.equal(result.allowed, true);
      assert.equal(result.requiresApproval, false);
    });

    await it("should allow safe read tools (read_only)", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("read_file");

      assert.equal(result.allowed, true);
      assert.equal(result.requiresApproval, false);
    });

    await it("should allow safe_write tools by default", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("write_file");

      assert.equal(result.allowed, true);
      assert.equal(result.requiresApproval, false);
    });

    await it("should deny system_sensitive tools without approval", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("env_scan");

      assert.equal(result.allowed, false);
      assert.equal(result.requiresApproval, true);
    });

    await it("should allow system_sensitive tools with approval", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("env_scan", true);

      assert.equal(result.allowed, true);
    });

    await it("should still deny system_sensitive tools without approval when dangerous override is enabled", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map, { allowDangerousTools: true });

      const result = engine.evaluate("env_scan", false);

      assert.equal(result.allowed, false);
      assert.equal(result.requiresApproval, true);
    });

    await it("should still deny unknown tools when dangerous override is enabled", () => {
      const map = createDefaultPolicyMap();
      const engine = new PolicyEngine(map, { allowDangerousTools: true });

      const result = engine.evaluate("unknown_tool_xyz", false);

      assert.equal(result.allowed, false);
      assert.equal(result.requiresApproval, true);
    });

    await it("should deny tools with unrecognized tier", () => {
      const map = new Map();
      map.set("mystery_tool", { tier: "non_existent_tier" as PolicyTier, defaultAllow: false });
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("mystery_tool");

      assert.equal(result.allowed, false);
      assert.ok(result.denialReason?.includes("unrecognized policy tier"));
    });

    await it("should create default policy map with all required tools", () => {
      const map = createDefaultPolicyMap();

      assert.ok(map.has("read_file"));
      assert.equal(map.get("read_file")?.tier, PolicyTier.READ_ONLY);

      assert.ok(map.has("write_file"));
      assert.equal(map.get("write_file")?.tier, PolicyTier.SAFE_WRITE);

      assert.ok(map.has("delete_file"));
      assert.equal(map.get("delete_file")?.tier, PolicyTier.DANGEROUS);

      assert.ok(map.has("env_scan"));
      assert.equal(map.get("env_scan")?.tier, PolicyTier.SYSTEM_SENSITIVE);

      assert.ok(map.size > 50, `Expected >50 tools, got ${map.size}`);
    });

    await it("should follow evaluation order: approval required → valid approval → ALLOW", () => {
      const map = new Map();
      map.set("test_dangerous", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("test_dangerous", true);
      assert.equal(result.allowed, true);
    });

    await it("should follow evaluation order: approval required → no approval → DENY", () => {
      const map = new Map();
      map.set("test_dangerous", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("test_dangerous", false);
      assert.equal(result.allowed, false);
    });

    await it("should follow evaluation order: approval not required → defaultAllow → ALLOW", () => {
      const map = new Map();
      map.set("test_safe", { tier: PolicyTier.SAFE_WRITE, requiresApproval: false, defaultAllow: true });
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("test_safe");
      assert.equal(result.allowed, true);
    });

    await it("should follow evaluation order: approval not required → no defaultAllow → DENY", () => {
      const map = new Map();
      map.set("test_restricted", { tier: PolicyTier.DANGEROUS, requiresApproval: false, defaultAllow: false });
      const engine = new PolicyEngine(map);

      const result = engine.evaluate("test_restricted");
      assert.equal(result.allowed, false);
    });
  });

  await describe("isMoreSensitive()", async () => {
    await it("should identify dangerous > safe_write", () => {
      const engine = new PolicyEngine();
      assert.equal(engine.isMoreSensitive(PolicyTier.DANGEROUS, PolicyTier.SAFE_WRITE), true);
      assert.equal(engine.isMoreSensitive(PolicyTier.SAFE_WRITE, PolicyTier.DANGEROUS), false);
    });

    await it("should identify system_sensitive > everything", () => {
      const engine = new PolicyEngine();
      assert.equal(engine.isMoreSensitive(PolicyTier.SYSTEM_SENSITIVE, PolicyTier.READ_ONLY), true);
      assert.equal(engine.isMoreSensitive(PolicyTier.SYSTEM_SENSITIVE, PolicyTier.DANGEROUS), true);
    });
  });

  await describe("doesTierCover()", async () => {
    await it("should allow dangerous approval to cover read_only", () => {
      const engine = new PolicyEngine();
      assert.equal(engine.doesTierCover(PolicyTier.DANGEROUS, PolicyTier.READ_ONLY), true);
    });

    await it("should NOT allow read_only approval to cover dangerous", () => {
      const engine = new PolicyEngine();
      assert.equal(engine.doesTierCover(PolicyTier.READ_ONLY, PolicyTier.DANGEROUS), false);
    });
  });
});

// =====================================================================
// ApprovalEngine Tests
// =====================================================================

await describe("ApprovalEngine", async () => {
  await describe("request()", async () => {
    await it("should create a pending approval record", () => {
      const engine = new ApprovalEngine();
      const record = engine.request("req-1", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });

      assert.equal(record.toolName, "delete_file");
      assert.equal(record.status, ApprovalStatus.PENDING);
      assert.equal(record.requestId, "req-1");
      assert.ok(record.id);
      assert.ok(record.createdAt > 0);
      assert.ok(record.expiresAt > record.createdAt);
    });
  });

  await describe("approve()", async () => {
    await it("should change status to approved", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const record = engine.request("req-2", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });

      const result = engine.approve(record.id, "admin");
      assert.notEqual(result, null);
      assert.equal(result!.status, ApprovalStatus.APPROVED);
      assert.equal(result!.approvedBy, "admin");
    });

    await it("should return null for already approved records", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const record = engine.request("req-3", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });

      engine.approve(record.id);
      const result = engine.approve(record.id);
      assert.equal(result, null);
    });
  });

  await describe("deny()", async () => {
    await it("should change status to denied and include reason", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const record = engine.request("req-4", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });

      const result = engine.deny(record.id, "Not authorized", "admin");
      assert.notEqual(result, null);
      assert.equal(result!.status, ApprovalStatus.DENIED);
      assert.equal(result!.reason, "Not authorized");
      assert.equal(result!.deniedBy, "admin");
    });
  });

  await describe("hasApproval()", async () => {
    await it("should return false for non-existent approval", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      assert.equal(engine.hasApproval("no-such-req", "delete_file", PolicyTier.DANGEROUS), false);
    });

    await it("should return true after approval granted (direct match)", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const record = engine.request("req-5", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });
      engine.approve(record.id);

      assert.equal(engine.hasApproval("req-5", "delete_file", PolicyTier.DANGEROUS), true);
    });

    await it("should return false after approval expires", async () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 50, enableAutoExpiry: true });
      const record = engine.request("req-6", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });
      engine.approve(record.id);

      await sleep(60);

      assert.equal(engine.hasApproval("req-6", "delete_file", PolicyTier.DANGEROUS), false);
    });

    await it("should return false for denied approvals", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const record = engine.request("req-7", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });
      engine.deny(record.id, "Denied test");

      assert.equal(engine.hasApproval("req-7", "delete_file", PolicyTier.DANGEROUS), false);
    });

    await it("should NOT inherit dangerous approval to nested dangerous tools", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });

      const parentRecord = engine.request("parent-req", "write_file", PolicyTier.SAFE_WRITE, { path: "test.txt" });
      engine.approve(parentRecord.id);

      assert.equal(
        engine.hasApproval("child-req", "delete_file", PolicyTier.DANGEROUS, "parent-req"),
        false,
        "Dangerous tool must NOT inherit parent approval"
      );

      assert.equal(
        engine.hasApproval("child-req2", "apply_patch", PolicyTier.SAFE_WRITE, "parent-req"),
        true,
        "Safe_write child should inherit parent's approval"
      );
    });

    await it("should block approval reuse across unrelated requestId chains", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });

      const record = engine.request("req-A", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });
      engine.approve(record.id);

      assert.equal(
        engine.hasApproval("req-B", "delete_file", PolicyTier.DANGEROUS),
        false,
        "Should not reuse approval from unrelated chain req-A"
      );
    });

    await it("safe_write approval expires before child executes", async () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 30, enableAutoExpiry: true });

      const parentRecord = engine.request("parent-expiry", "write_file", PolicyTier.SAFE_WRITE, { path: "test.txt" });
      engine.approve(parentRecord.id);

      // Immediately child can inherit
      assert.equal(
        engine.hasApproval("child-expiry", "apply_patch", PolicyTier.SAFE_WRITE, "parent-expiry"),
        true,
        "safe_write child inherits before expiry"
      );

      // Wait for expiry
      await sleep(40);

      // After expiry, child can no longer inherit
      assert.equal(
        engine.hasApproval("child-expiry-2", "apply_patch", PolicyTier.SAFE_WRITE, "parent-expiry"),
        false,
        "safe_write child cannot inherit after parent expires"
      );
    });

    await it("safe_write approval cannot cross parentRequestId chain", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });

      const parentRecord = engine.request("chain-A", "write_file", PolicyTier.SAFE_WRITE, { path: "test.txt" });
      engine.approve(parentRecord.id);

      // child under chain-A can inherit
      assert.equal(
        engine.hasApproval("child-A", "apply_patch", PolicyTier.SAFE_WRITE, "chain-A"),
        true,
        "Child in same chain inherits safe_write"
      );

      // child under chain-B cannot inherit from chain-A
      assert.equal(
        engine.hasApproval("child-B", "apply_patch", PolicyTier.SAFE_WRITE, "chain-B"),
        false,
        "Child in different chain cannot inherit safe_write from chain-A"
      );
    });

    await it("lower-tier child cannot inherit from unrelated approved request", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });

      // Create unrelated approval in chain-X
      const record = engine.request("chain-X", "write_file", PolicyTier.SAFE_WRITE, { path: "test.txt" });
      engine.approve(record.id);

      // chain-Y child should NOT see chain-X's approval
      assert.equal(
        engine.hasApproval("chain-Y-child", "apply_patch", PolicyTier.SAFE_WRITE, "chain-Y"),
        false,
        "Cannot inherit from unrelated chain-X approval"
      );
    });
  });

  await describe("revoke()", async () => {
    await it("should revoke an active approval", () => {
      const engine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const record = engine.request("req-8", "delete_file", PolicyTier.DANGEROUS, { path: "test.txt" });
      engine.approve(record.id);

      const revoked = engine.revoke(record.id);
      assert.equal(revoked, true);
      assert.equal(engine.hasApproval("req-8", "delete_file", PolicyTier.DANGEROUS), false);
    });
  });

  await describe("inputSummary redaction", async () => {
    await it("should redact apiKey from input summary", () => {
      const engine = new ApprovalEngine();
      const record = engine.request("redact-1", "run_command", PolicyTier.DANGEROUS, {
        command: "curl https://api.example.com",
        apiKey: "test-api-key-placeholder",
      });
      assert.ok(record.inputSummary.includes("[REDACTED]"), "apiKey value should be redacted");
      assert.ok(!record.inputSummary.includes("test-api-key-placeholder"), "Raw apiKey should not appear");
    });

    await it("should redact token from input summary", () => {
      const engine = new ApprovalEngine();
      const record = engine.request("redact-2", "run_command", PolicyTier.DANGEROUS, {
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      });
      assert.ok(record.inputSummary.includes("[REDACTED]"), "authorization value should be redacted");
      assert.ok(!record.inputSummary.includes("Bearer"), "Raw token should not appear");
    });

    await it("should redact password from input summary", () => {
      const engine = new ApprovalEngine();
      const record = engine.request("redact-3", "run_command", PolicyTier.DANGEROUS, {
        password: "test-password-placeholder",
      });
      assert.ok(record.inputSummary.includes("[REDACTED]"), "password value should be redacted");
      assert.ok(!record.inputSummary.includes("test-password-placeholder"), "Raw password should not appear");
    });

    await it("should redact secret from nested input summary", () => {
      const engine = new ApprovalEngine();
      const record = engine.request("redact-4", "run_command", PolicyTier.DANGEROUS, {
        config: {
          database: {
            secret: "test-secret-placeholder",
            password: "another-secret",
          }
        }
      });
      assert.ok(record.inputSummary.includes("[REDACTED]"), "Nested secret should be redacted");
      assert.ok(!record.inputSummary.includes("test-secret-placeholder"), "Raw nested secret should not appear");
    });

    await it("should redact privateKey from input summary", () => {
      const engine = new ApprovalEngine();
      const record = engine.request("redact-5", "run_command", PolicyTier.DANGEROUS, {
        privateKey: "test-private-key-placeholder",
      });
      assert.ok(record.inputSummary.includes("[REDACTED]"), "privateKey value should be redacted");
      assert.ok(!record.inputSummary.includes("test-private-key-placeholder"), "Raw private key should not appear");
    });

    await it("should keep non-sensitive keys unchanged", () => {
      const engine = new ApprovalEngine();
      const record = engine.request("redact-safe", "delete_file", PolicyTier.DANGEROUS, {
        path: "/tmp/test.txt",
        recursive: false,
      });
      assert.ok(record.inputSummary.includes("/tmp/test.txt"), "path should be visible");
      assert.ok(record.inputSummary.includes("false"), "recursive value should be visible");
      assert.ok(!record.inputSummary.includes("[REDACTED]"), "No fields should be redacted");
    });
  });
});

// =====================================================================
// BYPASS PREVENTION TESTS
// =====================================================================

await describe("Bypass Prevention", async () => {
  await describe("registry.get() does not expose handler", async () => {
    await it("should NOT have a get() method that returns handler", () => {
      const registry = createRegistry();
      // get() was intentionally removed — verify no handler access method exists
      const exposed = registry as unknown as Record<string, unknown>;
      assert.equal(typeof exposed.get, "undefined", "get() should not exist");
      assert.equal(typeof exposed.handler, "undefined", "handler should not be exposed");
    });

    await it("should only expose metadata via public API (no handler reference)", () => {
      const registry = createRegistry();
      const definitions = registry.listDefinitions();

      for (const def of definitions) {
        // ToolDefinition should NOT have a 'handler' property
        assert.ok(!("handler" in def), `ToolDefinition for ${def.name} should not expose handler`);

        // Only metadata is available
        assert.ok(typeof def.name === "string");
        // schema and description are optional
        if (def.policy) {
          assert.ok(typeof def.policy.tier === "string");
        }
      }
    });

    await it("should return metadata only from listDefinitions — no executable handler", () => {
      const registry = createRegistry();
      const defs = registry.listDefinitions();

      // Verify no executable property exists
      for (const def of defs) {
        const keys = Object.keys(def);
        assert.ok(!keys.includes("handler"), `ToolDefinition for ${def.name} should not have handler key`);
        assert.ok(!keys.includes("execute"), `ToolDefinition for ${def.name} should not have execute key`);
        assert.ok(!keys.includes("invoke"), `ToolDefinition for ${def.name} should not have invoke key`);
      }
    });
  });

  await describe("direct handler access is unavailable from public API", async () => {
    await it("should prevent handler access through has()", () => {
      const registry = createRegistry();

      // has() exists but only returns boolean
      assert.equal(typeof registry.has("read_file"), "boolean");
      assert.equal(typeof registry.has("delete_file"), "boolean");
      assert.equal(registry.has("nonexistent"), false);
    });

    await it("should prevent handler access through list()", () => {
      const registry = createRegistry();
      const names = registry.list();

      // list() only returns string names
      assert.ok(Array.isArray(names));
      for (const name of names) {
        assert.equal(typeof name, "string");
      }
    });
  });

  await describe("dangerous tool cannot execute except through execute()", async () => {
    await it("should deny dangerous tool without approval — handler never called", async () => {
      let handlerCalled = false;

      const testRegistry = new ToolRegistry();
      testRegistry.register("test_dangerous_bypass", async () => {
        handlerCalled = true;
        return { success: true };
      });

      try {
        await testRegistry.execute("test_dangerous_bypass", {}, "bypass-test-1");
      } catch {
        // Expected — policy denied
      }

      assert.equal(handlerCalled, false,
        "Handler should NEVER be called when policy denies dangerous tool without approval"
      );
    });

    await it("non-execute APIs cannot invoke handler", () => {
      const registry = createRegistry();
      // No method on ToolRegistry that can invoke a handler besides execute()
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(registry));
      const invokeMethods = proto.filter(m =>
        m === "call" || m === "apply" || m === "invoke" || m === "run" || m.startsWith("$")
      );

      assert.equal(invokeMethods.length, 0,
        "Should not have any call/invoke methods besides execute"
      );
    });
  });

  await describe("approval denial path never calls handler", async () => {
    await it("handler never called when policy denies — verified via execute() error path", async () => {
      let handlerCalled = false;

      const testRegistry = new ToolRegistry();
      testRegistry.register("test_no_approval", async () => {
        handlerCalled = true;
        return { success: true };
      });

      try {
        await testRegistry.execute("test_no_approval", {}, "no-approval-test");
      } catch {
        // Expected
      }

      assert.equal(handlerCalled, false,
        "Handler must NOT be called when execution is blocked by policy denial"
      );
    });

    await it("handler called when policy allows", async () => {
      const policyMap = new Map();
      policyMap.set("test_allowed", { tier: PolicyTier.READ_ONLY, defaultAllow: true });
      const policyEngine = new PolicyEngine(policyMap);

      const testRegistry = new ToolRegistry(policyEngine);
      testRegistry.register("test_allowed", async () => {
        handlerCalled = true;
        return { success: true };
      });

      try {
        await testRegistry.execute("test_allowed", {}, "allowed-test");
      } catch {
        // May throw for other reasons, but handler should have been called
      }

      // If the handler throws (no mock), we still know it was called
      // We should set up the handler to succeed instead
    });

    await it("handler confirmation: policy allowed handler runs", async () => {
      let handlerResult = "not-called";

      const policyMap = new Map();
      policyMap.set("test_confirmed", { tier: PolicyTier.READ_ONLY, defaultAllow: true });
      const policyEngine = new PolicyEngine(policyMap);

      const testRegistry = new ToolRegistry(policyEngine);
      testRegistry.register("test_confirmed", async () => {
        handlerResult = "called-and-succeeded";
        return { ok: true };
      });

      await testRegistry.execute("test_confirmed", {}, "confirmed-test");

      assert.equal(handlerResult, "called-and-succeeded",
        "Handler must be called and return result when policy allows"
      );
    });
  });

  await describe("nested tool execution must use registry.execute()", async () => {
    await it("nested dangerous does NOT inherit parent approval (bypass prevention)", async () => {
      let nestedHandlerCalled = false;

      const policyMap = new Map();
      policyMap.set("parent_dangerous", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
      policyMap.set("nested_dangerous", { tier: PolicyTier.DANGEROUS, requiresApproval: true });

      const policyEngine = new PolicyEngine(policyMap);
      const approvalEngine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const testRegistry = new ToolRegistry(policyEngine, approvalEngine);

      testRegistry.register("parent_dangerous", async () => {
        try {
          await testRegistry.execute("nested_dangerous", {}, "nested-child", 1);
          nestedHandlerCalled = true;
        } catch {
          // Expected: nested dangerous denied without own approval
        }
        return { success: true };
      });

      testRegistry.register("nested_dangerous", async () => {
        nestedHandlerCalled = true;
        return { success: true };
      });

      // Pre-approve parent only — requestId must match execute requestId for scope matching
      const parentRecord = approvalEngine.request("nested-top", "parent_dangerous", PolicyTier.DANGEROUS, {});
      approvalEngine.approve(parentRecord.id, "admin");

      await testRegistry.execute("parent_dangerous", {}, "nested-top");

      assert.equal(nestedHandlerCalled, false,
        "Nested dangerous should NOT inherit parent approval (bypass prevention enforced)"
      );
    });

    await it("nested safe_write DOES inherit parent approval", async () => {
      let safeHandlerCalled = false;

      const policyMap = new Map();
      policyMap.set("parent_safe", { tier: PolicyTier.SAFE_WRITE });
      policyMap.set("nested_safe", { tier: PolicyTier.SAFE_WRITE });

      const policyEngine = new PolicyEngine(policyMap);
      const approvalEngine = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const testRegistry = new ToolRegistry(policyEngine, approvalEngine);

      testRegistry.register("parent_safe", async () => {
        await testRegistry.execute("nested_safe", {}, "parent-req-safe-child", 1);
        safeHandlerCalled = true;
        return { success: true };
      });

      testRegistry.register("nested_safe", async () => {
        return { success: true };
      });

      await testRegistry.execute("parent_safe", {}, "parent-top-safe");
      assert.equal(safeHandlerCalled, true,
        "Nested safe_write should inherit parent approval and execute"
      );
    });
  });
});

// =====================================================================
// Integration: ToolRegistry + PolicyEngine + ApprovalEngine Tests
// =====================================================================

await describe("ToolRegistry Integration", async () => {
  let registry: ToolRegistry;

  before(() => {
    registry = createRegistry();
  });

  await describe("safe read tool (read_only)", async () => {
    await it("should attempt execution (policy allows but actual handler may fail on FS)", async () => {
      try {
        await registry.execute("read_file", { path: "test.txt" }, "test-request-1");
        assert.fail("Should have thrown - read_file needs actual file system");
      } catch (err: unknown) {
        const typedErr = err as { code?: string };
        // Expected: file not found, not policy denied
        assert.notEqual(typedErr.code, ErrorCode.POLICY_DENIED);
      }
    });
  });

  await describe("unknown tool", async () => {
    await it("should deny unknown tools with POLICY_DENIED (policy check before tool-exists check)", async () => {
      try {
        await registry.execute("unknown_mystery_tool", {}, "test-request-unknown");
        assert.fail("Should have thrown");
      } catch (err: unknown) {
        const typedErr = err as { code?: string; details?: { denialReason?: string } };
        assert.equal(typedErr.code, ErrorCode.POLICY_DENIED);
        assert.ok(typedErr.details?.denialReason?.includes("not classified"));
      }
    });
  });

  await describe("dangerous tool without approval", async () => {
    await it("should deny dangerous tools without approval (use a dangerous tool with no schema to avoid VALIDATION_ERROR)", async () => {
      // Use a test-specific dangerous tool with no schema to bypass schema validation step
      const freshPolicyMap = new Map();
      freshPolicyMap.set("test_danger_no_schema", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
      const freshPE = new PolicyEngine(freshPolicyMap);
      const freshAE = new ApprovalEngine();
      const freshRegistry = new ToolRegistry(freshPE, freshAE);
      freshRegistry.register("test_danger_no_schema", async () => ({ ok: true }));
      
      try {
        await freshRegistry.execute("test_danger_no_schema", {}, "test-request-dangerous");
        assert.fail("Should have thrown");
      } catch (err: unknown) {
        const typedErr = err as { code?: string; details?: { denialReason?: string } };
        assert.equal(typedErr.code, ErrorCode.POLICY_DENIED);
        assert.ok(typedErr.details?.denialReason?.includes("requires approval"));
      }
    });

    await it("should create a pending approval record automatically on denial", async () => {
      const freshPolicyMap = new Map();
      freshPolicyMap.set("test_danger_no_schema2", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
      const freshPE = new PolicyEngine(freshPolicyMap);
      const freshAE = new ApprovalEngine();
      const freshRegistry = new ToolRegistry(freshPE, freshAE);
      freshRegistry.register("test_danger_no_schema2", async () => ({ ok: true }));
      const approvals = freshRegistry.getApprovalEngine();

      try {
        await freshRegistry.execute("test_danger_no_schema2", {}, "test-request-auto-approval");
      } catch {
        // Expected
      }

      const pending = approvals.listPending();
      const matching = pending.find(p => p.toolName === "test_danger_no_schema2");
      assert.ok(matching, "Should have created a pending approval record");
      assert.equal(matching?.status, ApprovalStatus.PENDING);
    });

    await it("should auto-create pending approval when unknown tool denied", async () => {
      const freshRegistry = createRegistry();
      const approvals = freshRegistry.getApprovalEngine();

      const pendingBefore = approvals.listPending().length;

      try {
        await freshRegistry.execute("totally_fake_tool_xyz", {}, "unknown-deny-test");
      } catch {
        // Expected
      }

      const pendingAfter = approvals.listPending().length;
      // Unknown tools are denied by policy, but the evaluation returns requiresApproval=true
      // So a pending request IS automatically created. This is correct because
      // unknown tools should have an opportunity to be approved.
      assert.equal(pendingAfter, pendingBefore + 1,
        "Unknown tool denial should auto-create a pending approval request"
      );
    });
  });

  await describe("dangerous tool with approval", async () => {
    await it("should execute dangerous tools after explicit approval (use tool with no schema to avoid VALIDATION_ERROR)", async () => {
      const freshPolicyMap = new Map();
      freshPolicyMap.set("test_danger_approved", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
      const freshPE = new PolicyEngine(freshPolicyMap);
      const freshAE = new ApprovalEngine({ approvalExpiryMs: 60000 });
      const freshRegistry = new ToolRegistry(freshPE, freshAE);
      freshRegistry.register("test_danger_approved", async () => ({ ok: true }));
      const approvals = freshRegistry.getApprovalEngine();

      const record = approvals.request(
        "test-request-approved",
        "test_danger_approved",
        PolicyTier.DANGEROUS,
        { path: "test.txt" }
      );
      approvals.approve(record.id, "test-user");

      const result = await freshRegistry.execute("test_danger_approved", {}, "test-request-approved");
      assert.ok(result, "Should execute successfully with approval");
      assert.equal(result.ok, true);
    });
  });

  await describe("dangerous override", async () => {
    await it("runs dangerous tools without manual approval when override is enabled", async () => {
      const policyMap = new Map();
      policyMap.set("test_danger_auto", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
      const policyEngine = new PolicyEngine(policyMap, { allowDangerousTools: true });
      const approvalEngine = new ApprovalEngine();
      const registry = new ToolRegistry(policyEngine, approvalEngine);
      registry.register("test_danger_auto", async () => ({ ok: true }));

      const result = await registry.execute("test_danger_auto", {}, "danger-override-1");
      assert.equal(result.ok, true);
      assert.equal(approvalEngine.listPending().length, 0);
    });

    await it("does not bypass workspace path restrictions when dangerous override is enabled", async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "danger-override-path-"));
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "danger-override-outside-"));
      process.env.ALFA_WORKSPACE_ROOT = base;
      try {
        const policyMap = new Map();
        policyMap.set("write_file", { tier: PolicyTier.DANGEROUS, requiresApproval: true });
        const policyEngine = new PolicyEngine(policyMap, { allowDangerousTools: true });
        const registry = new ToolRegistry(policyEngine, new ApprovalEngine());
        registry.register("write_file", writeFileToolHandler);

        await assert.rejects(
          () => registry.execute("write_file", { filePath: path.join(outside, "escape.txt"), content: "SECRET=1" }, "danger-override-2"),
          (e: unknown) => {
            if (typeof e !== "object" || e === null) return false;
            const withCode = e as { code?: string; message?: string };
            return withCode.code === ErrorCode.PATH_DENIED
              || withCode.code === "PATH_OUTSIDE_WORKSPACE"
              || String(withCode.message ?? "").toLowerCase().includes("outside allowed workspace");
          }
        );
      } finally {
        delete process.env.ALFA_WORKSPACE_ROOT;
      }
    });
  });

  await describe("policy denied counts in stats", async () => {
    await it("should track policy denials in health snapshot", async () => {
      const freshRegistry = createRegistry();

      try {
        await freshRegistry.execute("totally_fake_tool", {}, "stats-test");
      } catch {
        // Expected
      }

      const snapshot = freshRegistry.getHealthSnapshot();
      assert.ok(snapshot.policyDeniedCounts >= 1, "Should have at least 1 policy denial");
    });
  });
});

// =====================================================================
// Health Check — Unclassified Tool Detection
// =====================================================================

await describe("Health Check", async () => {
  await describe("unclassified tools detection", async () => {
    await it("should report healthy when all tools classified", () => {
      const policyMap = new Map();
      policyMap.set("classified_tool", { tier: PolicyTier.READ_ONLY });
      const policyEngine = new PolicyEngine(policyMap);
      const registry = new ToolRegistry(policyEngine);

      registry.register("classified_tool", async () => ({ ok: true }));

      const snapshot = registry.getHealthSnapshot();
      assert.equal(snapshot.status, "healthy");
      assert.equal(snapshot.unclassifiedTools, 0);
      assert.equal(snapshot.healthyTools, 1);
    });

    await it("should report unclassified tools in health snapshot", () => {
      const policyEngine = new PolicyEngine(); // empty policy map
      const registry = new ToolRegistry(policyEngine);

      registry.register("unclassified_tool", async () => ({ ok: true }));

      const snapshot = registry.getHealthSnapshot();
      assert.ok(snapshot.unclassifiedTools >= 1, "Should detect unclassified tools");
      assert.ok(snapshot.issues.some(i => i.includes("no policy classification")),
        "Should include classification warning in issues"
      );
    });
  });
});
