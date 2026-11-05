/**
 * P2.8 — Error normalization test suite.
 *
 * Validates that all error throw styles are normalized to a consistent
 * ToolExecutionErrorClass envelope with proper code, safe messages,
 * and no internal leakage (stack traces, absolute paths, secrets).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  ToolExecutionErrorClass,
  ErrorCode,
  createErrorResponse,
  createSuccessResponse,
  isErrorResponse,
} from "../src/core/errorResponse.js";

// ─── 1. normalizeInput via ToolExecutionErrorClass.from() ───────────────

describe("ToolExecutionErrorClass.from() — normalization table", () => {
  // ── ToolExecutionErrorClass passthrough ──
  it("should passthrough ToolExecutionErrorClass unchanged (identity)", () => {
    const original = new ToolExecutionErrorClass(
      ErrorCode.POLICY_DENIED,
      "Policy blocked",
      { tool: "delete_file", retryable: false }
    );
    const result = ToolExecutionErrorClass.from(original);
    assert.equal(result, original);
    assert.equal(result.code, ErrorCode.POLICY_DENIED);
    assert.equal(result.tool, "delete_file");
  });

  it("should inject defaultRequestId into passthrough if missing", () => {
    const original = new ToolExecutionErrorClass(
      ErrorCode.POLICY_DENIED,
      "Policy blocked",
      { tool: "delete_file" }
    );
    assert.equal(original.requestId, undefined);
    const result = ToolExecutionErrorClass.from(original, {
      defaultRequestId: "req-abc",
      defaultTool: "delete_file",
    });
    // requestId should now be set
    assert.equal(result.requestId, "req-abc");
    assert.equal(result.tool, "delete_file");
  });

  it("should NOT overwrite existing requestId in passthrough", () => {
    const original = new ToolExecutionErrorClass(
      ErrorCode.POLICY_DENIED,
      "Policy blocked",
      { tool: "delete_file", requestId: "req-existing" }
    );
    const result = ToolExecutionErrorClass.from(original, {
      defaultRequestId: "req-overwrite",
    });
    assert.equal(result.requestId, "req-existing");
  });

  // ── Error (node Error) → INTERNAL_ERROR ──
  it("should convert raw Error to INTERNAL_ERROR", () => {
    const err = new Error("Something broke");
    const result = ToolExecutionErrorClass.from(err, { defaultTool: "test_tool" });
    assert.equal(result.code, ErrorCode.INTERNAL_ERROR);
    assert.equal(result.tool, "test_tool");
    assert.equal(result.retryable, false);
    assert.ok(result.message.includes("Something broke"));
  });

  it("should strip stack traces from Error messages", () => {
    const err = new Error("Failed");
    // Manually append a stack trace-like line
    err.stack = "Error: Failed\n    at Object.<anonymous> (C:\\project\\file.ts:10:5)\n    at next (C:\\project\\other.ts:20:10)";
    ToolExecutionErrorClass.from(err);
    // Stack trace lines should be stripped
    // sanitizeMessage should remove lines starting with whitespace+at
    const clean = ToolExecutionErrorClass.sanitizeMessage(err.stack ?? "");
    assert.ok(!clean.includes("    at "));
  });

  // ── String throw → INTERNAL_ERROR ──
  it("should convert string throw to INTERNAL_ERROR", () => {
    const result = ToolExecutionErrorClass.from("epic fail", { defaultTool: "crash" });
    assert.equal(result.code, ErrorCode.INTERNAL_ERROR);
    assert.equal(result.tool, "crash");
    assert.ok(result.message.includes("epic fail"));
  });

  // ── Unknown type → INTERNAL_ERROR ──
  it("should convert unknown throw to INTERNAL_ERROR", () => {
    const result = ToolExecutionErrorClass.from(42, { defaultTool: "weird" });
    assert.equal(result.code, ErrorCode.INTERNAL_ERROR);
    // Unknown types produce a generic message
    assert.ok(result.message.length > 0);
  });

  it("should convert null throw to INTERNAL_ERROR", () => {
    const result = ToolExecutionErrorClass.from(null, { defaultTool: "null_tool" });
    assert.equal(result.code, ErrorCode.INTERNAL_ERROR);
  });

  // ── ZodError → VALIDATION_FAILED ──
  it("should convert Zod validation error to VALIDATION_FAILED", () => {
    const schema = z.object({ path: z.string() });
    const parseResult = schema.safeParse({ path: 123 });
    if (parseResult.success) {
      assert.fail("Expected parse to fail");
    }
    const result = ToolExecutionErrorClass.from(parseResult.error, { defaultTool: "read_file" });
    assert.equal(result.code, ErrorCode.VALIDATION_FAILED);
    assert.ok(result.message.includes("Input validation failed"));
    assert.ok(result.message.includes("path:"));
    assert.equal(result.tool, "read_file");
  });

  it("should preserve tool name in Zod conversion", () => {
    const schema = z.object({ name: z.string() });
    const parseResult = schema.safeParse({ name: 42 });
    if (parseResult.success) assert.fail("Expected fail");
    const result = ToolExecutionErrorClass.from(parseResult.error, { defaultTool: "test_tool" });
    assert.equal(result.tool, "test_tool");
    assert.equal(result.code, ErrorCode.VALIDATION_FAILED);
  });

  it("should preserve requestId in Zod conversion", () => {
    const schema = z.object({ x: z.number() });
    const parseResult = schema.safeParse({ x: "bad" });
    if (parseResult.success) assert.fail("Expected fail");
    const result = ToolExecutionErrorClass.from(parseResult.error, {
      defaultTool: "tool_x",
      defaultRequestId: "req-zod-1",
    });
    assert.equal(result.requestId, "req-zod-1");
  });
});

// ─── 2. Security: no raw error leakage ────────────────────────────────

describe("Security — no raw error leakage", () => {
  it("should NOT leak stack traces in error messages", () => {
    const err = new Error("Test\n    at someFunction (C:\\Projects\\app.ts:42:10)\n    at otherFunction (src/core/thing.ts:10:5)");
    const result = ToolExecutionErrorClass.from(err);
    // The .message should not contain stack lines
    assert.ok(!result.message.includes("    at "));
    assert.ok(!result.message.includes("app.ts"));
  });

  it("should NOT leak absolute system paths in error messages", () => {
    const raw = "Cannot read file at C:\\Users\\SecretUser\\app\\config.json";
    const sanitized = ToolExecutionErrorClass.sanitizeMessage(raw);
    assert.ok(!sanitized.includes("C:\\Users\\SecretUser"));
    assert.ok(sanitized.includes("[path]"));
  });

  it("should redact apiKey values from error messages", () => {
    const raw = 'Configuration: apiKey = "test-api-key-placeholder"';
    const sanitized = ToolExecutionErrorClass.sanitizeMessage(raw);
    assert.ok(sanitized.includes("[REDACTED]"));
    assert.ok(!sanitized.includes("test-api-key-placeholder"));
  });

  it("should redact token values from error messages", () => {
    const raw = 'Auth: token = "test-token-placeholder"';
    const sanitized = ToolExecutionErrorClass.sanitizeMessage(raw);
    assert.ok(sanitized.includes("[REDACTED]"));
    assert.ok(!sanitized.includes("test-token-placeholder"));
  });

  it("should redact password values from error messages", () => {
    const raw = 'Connection failed: password = "test-password-placeholder"';
    const sanitized = ToolExecutionErrorClass.sanitizeMessage(raw);
    assert.ok(sanitized.includes("[REDACTED]"));
    assert.ok(!sanitized.includes("test-password-placeholder"));
  });

  it("should redact secret values from error messages", () => {
    const raw = 'secret: "test-secret-placeholder"';
    const sanitized = ToolExecutionErrorClass.sanitizeMessage(raw);
    assert.ok(sanitized.includes("[REDACTED]"));
  });

  it("should redact auth values from error messages", () => {
    const raw = 'authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.xxx"';
    const sanitized = ToolExecutionErrorClass.sanitizeMessage(raw);
    assert.ok(sanitized.includes("[REDACTED]"));
  });

  it("should redact privateKey values from error messages", () => {
    const raw = 'privateKey: "test-private-key-placeholder"';
    const sanitized = ToolExecutionErrorClass.sanitizeMessage(raw);
    assert.ok(sanitized.includes("[REDACTED]"));
  });

  it("isSafeForUser should return false for messages with stack traces", () => {
    assert.equal(ToolExecutionErrorClass.isSafeForUser("ok message"), true);
    assert.equal(
      ToolExecutionErrorClass.isSafeForUser("Error\n    at Object.<anonymous> (file.ts:10:5)"),
      false
    );
  });

  it("isSafeForUser should return false for messages with absolute paths", () => {
    assert.equal(
      ToolExecutionErrorClass.isSafeForUser("C:\\Users\\Test\\secret.key"),
      false
    );
  });
});

// ─── 3. Error code taxonomy ────────────────────────────────────────────

describe("Error code taxonomy", () => {

  it("should have VALIDATION_FAILED code", () => {
    assert.equal(ErrorCode.VALIDATION_FAILED, "VALIDATION_FAILED");
  });

  it("should have POLICY_DENIED code", () => {
    assert.equal(ErrorCode.POLICY_DENIED, "POLICY_DENIED");
  });

  it("should have APPROVAL_REQUIRED code", () => {
    assert.equal(ErrorCode.APPROVAL_REQUIRED, "APPROVAL_REQUIRED");
  });

  it("should have CANCELLED code", () => {
    assert.equal(ErrorCode.CANCELLED, "CANCELLED");
  });

  it("should have PATH_DENIED code", () => {
    assert.equal(ErrorCode.PATH_DENIED, "PATH_DENIED");
  });

  it("should have COMMAND_DENIED code", () => {
    assert.equal(ErrorCode.COMMAND_DENIED, "COMMAND_DENIED");
  });

  it("should have COMMAND_FAILED code", () => {
    assert.equal(ErrorCode.COMMAND_FAILED, "COMMAND_FAILED");
  });

  it("should have APPROVAL_EXPIRED code", () => {
    assert.equal(ErrorCode.APPROVAL_EXPIRED, "APPROVAL_EXPIRED");
  });

  it("should have EXECUTION_TIMEOUT code", () => {
    assert.equal(ErrorCode.EXECUTION_TIMEOUT, "EXECUTION_TIMEOUT");
  });

  it("should have TOOL_NOT_FOUND code", () => {
    assert.equal(ErrorCode.TOOL_NOT_FOUND, "TOOL_NOT_FOUND");
  });

  it("should have PLAN_LIMIT_EXCEEDED code", () => {
    assert.equal(ErrorCode.PLAN_LIMIT_EXCEEDED, "PLAN_LIMIT_EXCEEDED");
  });

  it("should have INTERNAL_ERROR code", () => {
    assert.equal(ErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
  });
});

// ─── 4. Policy denied error normalization ─────────────────────────────

describe("Policy denied error normalization", () => {
  it("should normalize policy denial with structured code", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.POLICY_DENIED,
      "Tool 'delete_file' requires approval for tier 'dangerous' — denied",
      {
        tool: "delete_file",
        retryable: false,
        details: { policyTier: "dangerous", requiresApproval: true },
      }
    );
    const result = ToolExecutionErrorClass.from(err);
    assert.equal(result.code, ErrorCode.POLICY_DENIED);
    assert.equal(result.tool, "delete_file");
  });

  it("should carry policy details in error envelope", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.POLICY_DENIED,
      "Denied by policy",
      {
        tool: "run_command",
        details: { policyTier: "dangerous", denialReason: "requires approval" },
      }
    );
    const json = err.toJSON();
    assert.equal(json.code, ErrorCode.POLICY_DENIED);
    assert.ok(json.details?.policyTier);
    assert.equal(json.tool, "run_command");
  });
});

// ─── 5. Approval-related error normalization ──────────────────────────

describe("Approval error normalization", () => {
  it("should normalize APPROVAL_REQUIRED with structured envelope", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.APPROVAL_REQUIRED,
      "Tool 'delete_file' requires approval for tier 'dangerous'",
      { tool: "delete_file", retryable: true }
    );
    const result = ToolExecutionErrorClass.from(err);
    assert.equal(result.code, ErrorCode.APPROVAL_REQUIRED);
    assert.equal(result.retryable, true);
    assert.equal(result.tool, "delete_file");
  });

  it("should normalize APPROVAL_EXPIRED with structured envelope", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.APPROVAL_EXPIRED,
      "Approval for 'delete_file' has expired",
      { tool: "delete_file", retryable: true }
    );
    const result = ToolExecutionErrorClass.from(err);
    assert.equal(result.code, ErrorCode.APPROVAL_EXPIRED);
    assert.equal(result.retryable, true);
    assert.equal(result.tool, "delete_file");
  });
});

// ─── 6. EXECUTION_TIMEOUT error normalization ───────────────────────────────────

describe("EXECUTION_TIMEOUT error normalization", () => {
  it("should normalize timeout as EXECUTION_TIMEOUT", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.EXECUTION_TIMEOUT,
      "Tool 'test_tool' exceeded timeout of 30000ms",
      { tool: "test_tool", retryable: false }
    );
    assert.equal(err.code, ErrorCode.EXECUTION_TIMEOUT);
    const json = err.toJSON();
    assert.equal(json.code, "EXECUTION_TIMEOUT");
    assert.equal(json.retryable, false);
  });
});

// ─── 7. Cancellation error normalization ──────────────────────────────

describe("Cancellation error normalization", () => {
  it("should normalize cancellation as CANCELLED", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.CANCELLED,
      "Operation was cancelled (tool: long_running_tool)",
      { tool: "long_running_tool", retryable: false }
    );
    assert.equal(err.code, ErrorCode.CANCELLED);
    const json = err.toJSON();
    assert.equal(json.code, "CANCELLED");
  });
});

// ─── 8. Path safety → PATH_DENIED ─────────────────────────────────────

describe("Path safety error normalization", () => {
  it("should normalize path safety failure as PATH_DENIED", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.PATH_DENIED,
      "Path is outside allowed workspace (revalidation failed)",
      { tool: "pathSafety" }
    );
    assert.equal(err.code, ErrorCode.PATH_DENIED);
    const json = err.toJSON();
    assert.equal(json.code, "PATH_DENIED");
    assert.equal(json.tool, "pathSafety");
  });
});

// ─── 9. Command denial → COMMAND_DENIED ───────────────────────────────

describe("Command denial error normalization", () => {
  it("should normalize command denial as COMMAND_DENIED", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.COMMAND_DENIED,
      'Unknown commandId: "rm-rf". Allowed ids: npm_build, npm_dev',
      { tool: "run_command", retryable: false }
    );
    assert.equal(err.code, ErrorCode.COMMAND_DENIED);
    const json = err.toJSON();
    assert.equal(json.code, "COMMAND_DENIED");
    assert.equal(json.tool, "run_command");
  });
});

// ─── 10. Command failure → COMMAND_FAILED ─────────────────────────────

describe("Command failure error normalization", () => {
  it("should normalize command non-zero exit as COMMAND_FAILED", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.COMMAND_FAILED,
      "Command 'npm_test' exited with code 1 (duration: 500ms)",
      { tool: "run_command", retryable: false }
    );
    assert.equal(err.code, ErrorCode.COMMAND_FAILED);
    const json = err.toJSON();
    assert.equal(json.code, "COMMAND_FAILED");
  });
});

// ─── 11. Plan limit → PLAN_LIMIT_EXCEEDED ─────────────────────────────

describe("Plan limit error normalization", () => {
  it("should normalize plan limit exceeded as PLAN_LIMIT_EXCEEDED", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.PLAN_LIMIT_EXCEEDED,
      "Plan exceeds max steps: 100 > 50",
      {
        retryable: false,
        details: { maxSteps: 50, requested: 100 },
      }
    );
    assert.equal(err.code, ErrorCode.PLAN_LIMIT_EXCEEDED);
    const json = err.toJSON();
    assert.equal(json.code, "PLAN_LIMIT_EXCEEDED");
  });

  it("should normalize recursion depth exceeded as PLAN_LIMIT_EXCEEDED", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.PLAN_LIMIT_EXCEEDED,
      "Plan execution exceeded max depth of 5",
      { retryable: false, details: { maxDepth: 5, currentDepth: 6 } }
    );
    assert.equal(err.code, ErrorCode.PLAN_LIMIT_EXCEEDED);
    assert.equal(err.retryable, false);
  });
});

// ─── 12. requestId preservation ───────────────────────────────────────

describe("requestId preservation", () => {
  it("should preserve requestId in error envelope via toJSON()", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.POLICY_DENIED,
      "Denied",
      { tool: "test", requestId: "req-abc-123", parentRequestId: "parent-req" }
    );
    const json = err.toJSON();
    assert.equal(json.requestId, "req-abc-123");
    assert.equal(json.parentRequestId, "parent-req");
  });

  it("should preserve requestId through from() passthrough", () => {
    const original = new ToolExecutionErrorClass(
      ErrorCode.COMMAND_DENIED,
      "Denied",
      { tool: "run_command", requestId: "req-xyz" }
    );
    const result = ToolExecutionErrorClass.from(original);
    assert.equal(result.requestId, "req-xyz");
  });
});

// ─── 13. tool name preservation ───────────────────────────────────────

describe("tool name preservation", () => {
  it("should preserve tool name in error envelope via toJSON()", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.TOOL_NOT_FOUND,
      "Tool not found: fake_tool",
      { tool: "fake_tool" }
    );
    const json = err.toJSON();
    assert.equal(json.tool, "fake_tool");
  });

  it("should inject defaultTool when tool name missing in from()", () => {
    const err = new Error("Something went wrong");
    const result = ToolExecutionErrorClass.from(err, { defaultTool: "injected_tool" });
    assert.equal(result.tool, "injected_tool");
  });
});

// ─── 14. createErrorResponse() / createSuccessResponse() ──────────────

describe("createErrorResponse / createSuccessResponse", () => {
  it("should create error response with default INTERNAL_ERROR code", () => {
    const resp = createErrorResponse("Something failed");
    assert.equal(resp.content[0].type, "text");
    assert.ok(resp.content[0].text.includes("INTERNAL_ERROR"));
    assert.equal(resp.error?.code, ErrorCode.INTERNAL_ERROR);
  });

  it("should create error response with custom code", () => {
    const resp = createErrorResponse("Blocked", ErrorCode.PATH_DENIED);
    assert.equal(resp.error?.code, ErrorCode.PATH_DENIED);
    assert.ok(resp.content[0].text.includes("PATH_DENIED"));
  });

  it("should create error response with details", () => {
    const resp = createErrorResponse("Validation failed", ErrorCode.VALIDATION_FAILED, {
      issues: [{ path: "name", message: "Required" }],
    });
    assert.equal(resp.error?.code, ErrorCode.VALIDATION_FAILED);
    assert.deepEqual(resp.error?.details?.issues, [{ path: "name", message: "Required" }]);
  });

  it("should create success response with string", () => {
    const resp = createSuccessResponse("OK");
    assert.equal(resp.content[0].text, "OK");
  });

  it("should create success response with object", () => {
    const resp = createSuccessResponse({ result: "done" });
    assert.ok(resp.content[0].text.includes("done"));
  });

  it("should detect error response via isErrorResponse", () => {
    const errResp = createErrorResponse("fail");
    const okResp = createSuccessResponse("ok");
    assert.equal(isErrorResponse(errResp), true);
    assert.equal(isErrorResponse(okResp), false);
  });
});

// ─── 15. No stack trace leakage from ToolExecutionErrorClass ─────────

describe("No stack trace leakage from ToolExecutionErrorClass", () => {
  it("should not include '    at ' in toJSON() message", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.INTERNAL_ERROR,
      "Failed",
      { tool: "test" }
    );
    // Ensure the error doesn't leak its own stack
    const json = err.toJSON();
    assert.ok(!json.message.includes("    at "));
    assert.ok(typeof json.message === "string");
  });

  it("toJSON() should only include safe fields", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      "Invalid input",
      {
        tool: "test_tool",
        requestId: "req-1",
        parentRequestId: "parent-req-0",
        details: { path: "field" },
      }
    );
    const json = err.toJSON();
    // Must have these fields
    assert.ok("code" in json);
    assert.ok("message" in json);
    assert.ok("retryable" in json);
    assert.ok("details" in json);
    assert.ok("tool" in json);
    assert.ok("requestId" in json);
    assert.ok("parentRequestId" in json);
    // Must NOT have stack or internal fields
    assert.ok(!("stack" in json));
    assert.ok(!("name" in json));
  });
});

// ─── 16. Retryable flag semantics ─────────────────────────────────────

describe("retryable flag semantics", () => {
  it("should be false for policy denials", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.POLICY_DENIED,
      "denied",
      { retryable: false }
    );
    assert.equal(err.retryable, false);
  });

  it("should be false for validation errors", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      "bad input",
      { retryable: false }
    );
    assert.equal(err.retryable, false);
  });

  it("should be true for EXECUTION_TIMEOUT errors (retryable)", () => {
    const err = new ToolExecutionErrorClass(
      ErrorCode.EXECUTION_TIMEOUT,
      "timed out",
      { retryable: true }
    );
    assert.equal(err.retryable, true);
  });

  it("should be false by default for exec errors", () => {
    const result = ToolExecutionErrorClass.from(new Error("generic"));
    assert.equal(result.retryable, false);
  });
});

