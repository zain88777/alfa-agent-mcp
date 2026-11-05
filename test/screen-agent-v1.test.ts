import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { screenAgentController } from "../src/core/screenAgentController.js";
import { setScreenBridge } from "../src/core/screenBridge.js";
import { globalAuditTrail } from "../src/core/auditTrail.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";
import { requireMcpBearerTokenWithToken } from "../src/core/mcpAuth.js";

class FakeBridge {
  approved = true;
  activeTitle = "Notepad";
  async requestLocalApproval(): Promise<{ approved: boolean; reason?: string }> {
    return this.approved ? { approved: true } : { approved: false, reason: "denied" };
  }
  async showControlOverlay(): Promise<void> {}
  async hideControlOverlay(): Promise<void> {}
  async observe() {
    return {
      imageBase64: "ZmFrZQ==",
      width: 800,
      height: 600,
      scaleFactor: 1.25,
      displayId: "1",
      cursor: { x: 5, y: 6 },
      activeWindowTitle: this.activeTitle,
    };
  }
  async click(): Promise<void> {}
  async doubleClick(): Promise<void> {}
  async type(): Promise<void> {}
  async key(): Promise<void> {}
  async scroll(): Promise<void> {}
  async getStatus(): Promise<{ approved: boolean; emergencyStopped: boolean }> {
    return { approved: this.approved, emergencyStopped: false };
  }
  async getActiveWindowTitle(): Promise<string | null> {
    return this.activeTitle;
  }
}

function expectToolErrorCode(fn: () => Promise<unknown>, code: ErrorCode) {
  return assert.rejects(fn, (err: unknown) => {
    if (!(err instanceof ToolExecutionErrorClass)) return false;
    return err.code === code;
  });
}

describe("screen agent v1", () => {
  const originalEnv = { ...process.env };
  let bridge: FakeBridge;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ENABLE_SCREEN_AGENT = "true";
    process.env.SCREEN_AGENT_APPROVAL_TIMEOUT_MS = "120000";
    process.env.SCREEN_AGENT_ACTION_RATE_LIMIT_PER_MIN = "60";
    process.env.SCREEN_AGENT_OBSERVE_MAX_DIMENSION = "1280";
    process.env.SCREEN_AGENT_OBSERVE_JPEG_QUALITY = "70";
    bridge = new FakeBridge();
    setScreenBridge(bridge);
    screenAgentController.resetForTests();
    globalAuditTrail.clear();
  });

  it("disabled feature", async () => {
    process.env.ENABLE_SCREEN_AGENT = "false";
    await expectToolErrorCode(() => screenAgentController.start(), ErrorCode.POLICY_DENIED);
  });

  it("bearer auth required", async () => {
    let statusCode = 0;
    let nextCalled = false;
    const req = { header: () => undefined } as unknown as import("express").Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json() { return this; },
    } as unknown as import("express").Response;
    const next = () => { nextCalled = true; };
    requireMcpBearerTokenWithToken("abc", req, res, next);
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
  });

  it("approval required", async () => {
    await expectToolErrorCode(() => screenAgentController.observe(), ErrorCode.APPROVAL_REQUIRED);
  });

  it("active session success", async () => {
    const started = await screenAgentController.start();
    assert.equal(started.ok, true);
    const obs = await screenAgentController.observe();
    assert.equal(obs.width, 800);
    await screenAgentController.click({ x: 10, y: 10, button: "left" });
  });

  it("emergency stop latch", async () => {
    await screenAgentController.start();
    await screenAgentController.stop();
    await expectToolErrorCode(() => screenAgentController.observe(), ErrorCode.POLICY_DENIED);
  });

  it("redacted typing logs", async () => {
    await screenAgentController.start();
    await screenAgentController.type({ text: "super-secret" });
    const events = globalAuditTrail.snapshot();
    const e = events.find((x) => x.action === "screen_type");
    assert.ok(e);
    assert.equal(e?.payload.redacted, true);
    assert.equal(e?.payload.textLength, 12);
    assert.equal(Object.prototype.hasOwnProperty.call(e?.payload ?? {}, "text"), false);
  });

  it("observe metadata", async () => {
    await screenAgentController.start();
    const obs = await screenAgentController.observe();
    assert.equal(typeof obs.imageBase64, "string");
    assert.equal(obs.width > 0, true);
    assert.equal(obs.height > 0, true);
    assert.equal(typeof obs.scaleFactor, "number");
    assert.equal(typeof obs.displayId, "string");
    assert.equal(typeof obs.cursor?.x, "number");
    assert.equal(typeof obs.activeWindowTitle, "string");
  });

  it("headless bridge unavailable", async () => {
    setScreenBridge(null);
    await expectToolErrorCode(() => screenAgentController.start(), ErrorCode.SCREEN_AGENT_BRIDGE_UNAVAILABLE);
  });

  it("approval timeout", async () => {
    process.env.SCREEN_AGENT_APPROVAL_TIMEOUT_MS = "1000";
    await screenAgentController.start();
    await new Promise((r) => setTimeout(r, 1100));
    await expectToolErrorCode(() => screenAgentController.observe(), ErrorCode.APPROVAL_REQUIRED);
  });

  it("action rate limit", async () => {
    process.env.SCREEN_AGENT_ACTION_RATE_LIMIT_PER_MIN = "2";
    await screenAgentController.start();
    await screenAgentController.click({ x: 1, y: 1, button: "left" });
    await screenAgentController.scroll({ deltaY: 1 });
    await expectToolErrorCode(() => screenAgentController.key({ key: "A" }), ErrorCode.POLICY_DENIED);
  });
});
