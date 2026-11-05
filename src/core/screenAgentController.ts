import { ErrorCode, ToolExecutionErrorClass } from "./errorResponse.js";
import { globalAuditTrail } from "./auditTrail.js";
import { getScreenBridge } from "./screenBridge.js";
import { loadRuntimeConfig } from "./runtimeConfig.js";

type ScreenAgentState = "disabled" | "idle" | "awaiting_approval" | "active" | "stopped_emergency" | "error";

type ActionKind = "observe" | "move" | "click" | "double_click" | "type" | "key" | "scroll" | "wait";

class ScreenAgentController {
  private state: ScreenAgentState = "idle";
  private sessionId: string | null = null;
  private approvalExpiresAt: number | null = null;
  private emergencyLatched = false;
  private actionTimestamps: number[] = [];

  private ensureEnabled(): void {
    if (!loadRuntimeConfig().screenAgent.enabled) {
      this.state = "disabled";
      throw new ToolExecutionErrorClass(ErrorCode.POLICY_DENIED, "Screen agent is disabled. Set ENABLE_SCREEN_AGENT=true to enable.", {
        tool: "screen_agent",
        details: { code: "SCREEN_AGENT_DISABLED" },
      });
    }
    if (this.state === "disabled") this.state = "idle";
  }

  private requireBridge() {
    const bridge = getScreenBridge();
    if (!bridge) {
      throw new ToolExecutionErrorClass(ErrorCode.SCREEN_AGENT_BRIDGE_UNAVAILABLE, "Electron screen bridge is unavailable in this runtime.", {
        tool: "screen_agent",
        details: { code: "SCREEN_AGENT_BRIDGE_UNAVAILABLE" },
      });
    }
    return bridge;
  }

  private async ensureBridgeSafety(_kind: ActionKind): Promise<void> {
    const bridge = this.requireBridge();
    const status = await bridge.getStatus();
    if (status.emergencyStopped) {
      this.state = "stopped_emergency";
      this.emergencyLatched = true;
    }
  }

  private async ensureActiveSession(kind: ActionKind): Promise<void> {
    this.ensureEnabled();
    await this.ensureBridgeSafety(kind);
    if (this.emergencyLatched) {
      throw new ToolExecutionErrorClass(ErrorCode.POLICY_DENIED, "Emergency stop is latched. Run screen_start and approve a new session.", {
        tool: `screen_${kind}`,
        details: { code: "SCREEN_AGENT_EMERGENCY_LATCHED" },
      });
    }
    if (this.state !== "active" || !this.sessionId || !this.approvalExpiresAt || Date.now() > this.approvalExpiresAt) {
      this.state = "idle";
      throw new ToolExecutionErrorClass(ErrorCode.APPROVAL_REQUIRED, "No active approved screen session. Run screen_start first.", {
        tool: `screen_${kind}`,
        details: { code: "SCREEN_AGENT_APPROVAL_REQUIRED" },
      });
    }
  }

  private checkRateLimit(tool: string): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    this.actionTimestamps = this.actionTimestamps.filter((t) => t > oneMinuteAgo);
    const limit = loadRuntimeConfig().screenAgent.actionRateLimitPerMin;
    if (this.actionTimestamps.length >= limit) {
      throw new ToolExecutionErrorClass(ErrorCode.POLICY_DENIED, "Screen action rate limit exceeded.", {
        tool,
        details: { code: "SCREEN_AGENT_RATE_LIMITED", limitPerMin: limit },
      });
    }
    this.actionTimestamps.push(now);
  }

  private async ensureSafeContext(tool: string): Promise<void> {
    const bridge = this.requireBridge();
    const title = bridge.getActiveWindowTitle ? await bridge.getActiveWindowTitle() : null;
    const risky = /(uac|administrator|admin:|delete|recycle bin|payment|card|otp|2fa|verification code|password|terminal|powershell|cmd|command prompt)/i.test(title ?? "");
    if (risky) {
      throw new ToolExecutionErrorClass(ErrorCode.POLICY_DENIED, "Dangerous context detected; local approval required.", {
        tool,
        details: { code: "SCREEN_AGENT_DANGEROUS_CONTEXT", activeWindowTitle: title ?? null },
      });
    }
  }

  private startAudit(action: string, payload: Record<string, unknown>): void {
    globalAuditTrail.record("tool", action, payload);
  }

  async start(): Promise<{ ok: boolean; sessionId: string | null; state: ScreenAgentState }> {
    this.ensureEnabled();
    const bridge = this.requireBridge();
    this.state = "awaiting_approval";
    const timeoutMs = loadRuntimeConfig().screenAgent.approvalTimeoutMs;
    this.startAudit("screen_start_request", { timeoutMs });
    const result = await bridge.requestLocalApproval(timeoutMs);
    if (!result.approved) {
      this.state = "idle";
      this.startAudit("screen_start_denied", { reason: result.reason ?? "denied" });
      return { ok: false, sessionId: null, state: this.state };
    }
    this.emergencyLatched = false;
    this.sessionId = `screen_${Date.now()}`;
    this.approvalExpiresAt = Date.now() + timeoutMs;
    this.actionTimestamps = [];
    this.state = "active";
    await bridge.showControlOverlay();
    this.startAudit("screen_start_approved", { sessionId: this.sessionId, expiresAt: this.approvalExpiresAt });
    return { ok: true, sessionId: this.sessionId, state: this.state };
  }

  async observe() {
    await this.ensureActiveSession("observe");
    this.checkRateLimit("screen_observe");
    const bridge = this.requireBridge();
    const cfg = loadRuntimeConfig().screenAgent;
    const observed = await bridge.observe({
      maxDimension: cfg.observeMaxDimension,
      jpegQuality: cfg.observeJpegQuality,
    });
    this.startAudit("screen_observe", {
      sessionId: this.sessionId,
      width: observed.width,
      height: observed.height,
      displayId: observed.displayId,
    });
    return observed;
  }

  async click(input: { x: number; y: number; button: "left" | "right" | "middle" }) {
    await this.ensureActiveSession("click");
    this.checkRateLimit("screen_click");
    await this.ensureSafeContext("screen_click");
    await this.requireBridge().click(input);
    this.startAudit("screen_click", { sessionId: this.sessionId, ...input });
    return { ok: true };
  }

  async move(input: { x: number; y: number }) {
    await this.ensureActiveSession("move");
    this.checkRateLimit("screen_move");
    await this.ensureSafeContext("screen_move");
    await this.requireBridge().move(input);
    this.startAudit("screen_move", { sessionId: this.sessionId, ...input });
    return { ok: true };
  }

  async doubleClick(input: { x: number; y: number; button: "left" | "right" | "middle" }) {
    await this.ensureActiveSession("double_click");
    this.checkRateLimit("screen_double_click");
    await this.ensureSafeContext("screen_double_click");
    await this.requireBridge().doubleClick(input);
    this.startAudit("screen_double_click", { sessionId: this.sessionId, ...input });
    return { ok: true };
  }

  async type(input: { text: string }) {
    await this.ensureActiveSession("type");
    this.checkRateLimit("screen_type");
    await this.ensureSafeContext("screen_type");
    await this.requireBridge().type(input);
    this.startAudit("screen_type", { sessionId: this.sessionId, textLength: input.text.length, redacted: true });
    return { ok: true, textLength: input.text.length, redacted: true };
  }

  async key(input: { key: string; modifiers?: string[] }) {
    await this.ensureActiveSession("key");
    this.checkRateLimit("screen_key");
    await this.ensureSafeContext("screen_key");
    await this.requireBridge().key(input);
    this.startAudit("screen_key", { sessionId: this.sessionId, key: input.key, modifiers: input.modifiers ?? [] });
    return { ok: true };
  }

  async scroll(input: { deltaX?: number; deltaY: number }) {
    await this.ensureActiveSession("scroll");
    this.checkRateLimit("screen_scroll");
    await this.ensureSafeContext("screen_scroll");
    await this.requireBridge().scroll(input);
    this.startAudit("screen_scroll", { sessionId: this.sessionId, deltaX: input.deltaX ?? 0, deltaY: input.deltaY });
    return { ok: true };
  }

  async wait(input: { ms: number }) {
    await this.ensureActiveSession("wait");
    const ms = Math.max(1, Math.min(10000, input.ms));
    await new Promise((r) => setTimeout(r, ms));
    this.startAudit("screen_wait", { sessionId: this.sessionId, ms });
    return { ok: true, waitedMs: ms };
  }

  async stop(): Promise<{ ok: boolean; emergencyLatched: boolean }> {
    this.ensureEnabled();
    const bridge = this.requireBridge();
    this.state = "stopped_emergency";
    this.emergencyLatched = true;
    this.sessionId = null;
    this.approvalExpiresAt = null;
    this.actionTimestamps = [];
    await bridge.hideControlOverlay();
    this.startAudit("screen_stop", { emergencyLatched: true });
    return { ok: true, emergencyLatched: true };
  }

  status() {
    this.ensureEnabled();
    return {
      state: this.state,
      activeSessionId: this.sessionId,
      approvalExpiresAt: this.approvalExpiresAt,
      emergencyLatched: this.emergencyLatched,
      rateLimitPerMin: loadRuntimeConfig().screenAgent.actionRateLimitPerMin,
      observePolicy: {
        maxDimension: loadRuntimeConfig().screenAgent.observeMaxDimension,
        jpegQuality: loadRuntimeConfig().screenAgent.observeJpegQuality,
      },
    };
  }

  resetForTests(): void {
    this.state = "idle";
    this.sessionId = null;
    this.approvalExpiresAt = null;
    this.emergencyLatched = false;
    this.actionTimestamps = [];
  }
}

export const screenAgentController = new ScreenAgentController();
