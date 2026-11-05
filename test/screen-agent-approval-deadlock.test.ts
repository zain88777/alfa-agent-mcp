import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/core/toolLoader.js";
import { setScreenBridge } from "../src/core/screenBridge.js";
import { screenAgentController } from "../src/core/screenAgentController.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";

class FakeBridge {
  approved = true;
  emergencyStopped = false;
  activeTitle = "Notepad";

  async requestLocalApproval(): Promise<{ approved: boolean; reason?: string }> {
    return this.approved ? { approved: true } : { approved: false, reason: "denied" };
  }
  async showControlOverlay(): Promise<void> {}
  async hideControlOverlay(): Promise<void> {}
  async getStatus(): Promise<{ approved: boolean; emergencyStopped: boolean }> {
    return { approved: this.approved, emergencyStopped: this.emergencyStopped };
  }
  async observe() {
    return {
      imageBase64: "ZmFrZQ==",
      width: 1024,
      height: 768,
      scaleFactor: 1,
      displayId: "1",
      cursor: { x: 10, y: 20 },
      activeWindowTitle: this.activeTitle,
    };
  }
  async click(): Promise<void> {}
  async doubleClick(): Promise<void> {}
  async type(): Promise<void> {}
  async key(): Promise<void> {}
  async scroll(): Promise<void> {}
  async getActiveWindowTitle(): Promise<string | null> {
    return this.activeTitle;
  }
}

function assertToolErrorCode(error: unknown, code: ErrorCode): void {
  assert.ok(error instanceof ToolExecutionErrorClass);
  assert.equal(error.code, code);
}

describe("screen agent approval deadlock prevention", () => {
  const originalEnv = { ...process.env };
  let bridge: FakeBridge;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ENABLE_SCREEN_AGENT = "true";
    bridge = new FakeBridge();
    setScreenBridge(bridge);
    screenAgentController.resetForTests();
  });

  it("screen_start allowed pre-session", async () => {
    const registry = createRegistry();
    const res = await registry.execute("screen_start", {});
    assert.equal((res as { ok: boolean }).ok, true);
  });

  it("local approval activates session", async () => {
    const registry = createRegistry();
    await registry.execute("screen_start", {});
    const status = await registry.execute("screen_status", {}) as { state: string; activeSessionId: string | null };
    assert.equal(status.state, "active");
    assert.ok(status.activeSessionId);
  });

  it("observe/actions denied before approval", async () => {
    const registry = createRegistry();
    await assert.rejects(
      () => registry.execute("screen_observe", {}),
      (error: unknown) => {
        assertToolErrorCode(error, ErrorCode.APPROVAL_REQUIRED);
        return true;
      },
    );
    await assert.rejects(
      () => registry.execute("screen_click", { x: 1, y: 1, button: "left" }),
      (error: unknown) => {
        assertToolErrorCode(error, ErrorCode.APPROVAL_REQUIRED);
        return true;
      },
    );
  });

  it("observe/actions allowed after approval", async () => {
    const registry = createRegistry();
    await registry.execute("screen_start", {});
    const observed = await registry.execute("screen_observe", {}) as { width: number; height: number };
    assert.equal(observed.width > 0, true);
    assert.equal(observed.height > 0, true);
    const clicked = await registry.execute("screen_click", { x: 10, y: 10, button: "left" }) as { ok: boolean };
    assert.equal(clicked.ok, true);
  });

  it("screen_stop always callable", async () => {
    const registry = createRegistry();
    const stoppedIdle = await registry.execute("screen_stop", {}) as { ok: boolean; emergencyLatched: boolean };
    assert.equal(stoppedIdle.ok, true);
    assert.equal(stoppedIdle.emergencyLatched, true);

    await registry.execute("screen_start", {});
    const stoppedActive = await registry.execute("screen_stop", {}) as { ok: boolean; emergencyLatched: boolean };
    assert.equal(stoppedActive.ok, true);
    assert.equal(stoppedActive.emergencyLatched, true);
  });
});
