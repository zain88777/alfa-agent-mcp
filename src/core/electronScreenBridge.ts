import { setScreenBridge, type ScreenBridge, type ScreenObserveResult } from "./screenBridge.js";
import type { RuntimeConfig } from "./runtimeConfig.js";
import { LocalWindowsScreenBridge } from "./localWindowsScreenBridge.js";

class ElectronHttpScreenBridge implements ScreenBridge {
  constructor(
    private readonly bridgeUrl: string,
    private readonly bridgeToken: string,
  ) {}

  private async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${this.bridgeUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.bridgeToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`Electron bridge request failed (${response.status}) ${path}: ${raw.slice(0, 200)}`);
    }
    return response.json() as Promise<T>;
  }

  requestLocalApproval(timeoutMs: number): Promise<{ approved: boolean; reason?: string }> {
    return this.post("/screen-agent/start", { timeoutMs });
  }

  async showControlOverlay(): Promise<void> {
    await this.post("/screen-agent/show-overlay");
  }

  async hideControlOverlay(): Promise<void> {
    await this.post("/screen-agent/hide-overlay");
  }

  getStatus(): Promise<{ approved: boolean; emergencyStopped: boolean }> {
    return this.post("/screen-agent/status");
  }

  observe(options: { maxDimension: number; jpegQuality: number }): Promise<ScreenObserveResult> {
    return this.post("/screen-agent/observe", options);
  }

  async move(input: { x: number; y: number }): Promise<void> {
    await this.post("/screen-agent/move", input);
  }

  async click(input: { x: number; y: number; button: "left" | "right" | "middle" }): Promise<void> {
    await this.post("/screen-agent/click", input);
  }

  async doubleClick(input: { x: number; y: number; button: "left" | "right" | "middle" }): Promise<void> {
    await this.post("/screen-agent/double-click", input);
  }

  async type(input: { text: string }): Promise<void> {
    await this.post("/screen-agent/type", input);
  }

  async key(input: { key: string; modifiers?: string[] }): Promise<void> {
    await this.post("/screen-agent/key", input);
  }

  async scroll(input: { deltaX?: number; deltaY: number }): Promise<void> {
    await this.post("/screen-agent/scroll", input);
  }

  async getActiveWindowTitle(): Promise<string | null> {
    const res = await this.post<{ activeWindowTitle?: string | null }>("/screen-agent/active-window-title");
    return res.activeWindowTitle ?? null;
  }
}

export function configureScreenBridgeFromRuntime(runtime: RuntimeConfig): void {
  const bridgeUrl = runtime.screenAgent.bridgeUrl;
  const bridgeToken = runtime.screenAgent.bridgeToken;
  if (!bridgeUrl || !bridgeToken) {
    setScreenBridge(process.platform === "win32" ? new LocalWindowsScreenBridge() : null);
    return;
  }
  setScreenBridge(new ElectronHttpScreenBridge(bridgeUrl, bridgeToken));
}
