/**
 * Browser DevTools Bridge Client
 * 
 * Connects to the local WebSocket bridge server which relays commands
 * to the Chrome/Edge extension. Handles request/response correlation,
 * timeouts, and disconnection detection.
 */

import WebSocket from "ws";

export interface BrowserBridgeRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface BrowserBridgeResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface BrowserBridgeOptions {
  port?: number;
  host?: string;
  timeoutMs?: number;
}

const DEFAULT_PORT = 9223;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 15000;

interface PendingRequest {
  resolve: (value: BrowserBridgeResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrowserBridge {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private extensionConnected = false;
  private port: number;
  private host: string;
  private defaultTimeoutMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Array<(connected: boolean) => void> = [];

  constructor(options?: BrowserBridgeOptions) {
    this.port = options?.port ?? DEFAULT_PORT;
    this.host = options?.host ?? DEFAULT_HOST;
    this.defaultTimeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isExtensionConnected(): boolean {
    return this.extensionConnected;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.extensionConnected);
      } catch {
        // listener errors are non-fatal
      }
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://${this.host}:${this.port}`);

        this.ws.on("open", () => {
          this.connected = true;
          console.error(`[BrowserBridge] Connected to ws://${this.host}:${this.port}`);
          resolve();
        });

        this.ws.on("message", (data) => {
          try {
            const msg = JSON.parse(String(data)) as BrowserBridgeResponse & { type?: string };
            
            if (msg.type === "extension_status") {
              this.extensionConnected = !!msg.success;
              this.notifyListeners();
              return;
            }

            if (msg.id && this.pending.has(msg.id)) {
              const p = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              clearTimeout(p.timer);
              p.resolve(msg);
            }
          } catch {
            // ignore parse errors
          }
        });

        this.ws.on("close", () => {
          this.connected = false;
          this.extensionConnected = false;
          this.notifyListeners();
          console.error("[BrowserBridge] Disconnected");
          this.rejectAllPending("Bridge disconnected");
          this.scheduleReconnect();
        });

        this.ws.on("error", (err) => {
          console.error("[BrowserBridge] Error:", err.message);
          if (!this.connected) {
            reject(new Error(`Bridge connection failed: ${err.message}`));
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // ignore reconnect failures
      });
    }, 3000);
  }

  private rejectAllPending(reason: string): void {
    for (const [_id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending("Bridge disconnecting");
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.extensionConnected = false;
  }

  async send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<BrowserBridgeResponse> {
    if (!this.connected || !this.ws) {
      throw new Error("Bridge not connected");
    }

    const id = crypto.randomUUID();
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge request timed out after ${timeout}ms: ${method}`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      const request: BrowserBridgeRequest = { id, method, params };
      this.ws!.send(JSON.stringify(request), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`Bridge send failed: ${err.message}`));
        }
      });
    });
  }

  async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }

  async ensureExtensionConnected(): Promise<void> {
    await this.ensureConnected();
    if (!this.extensionConnected) {
      throw new Error("Browser extension not connected. Install and activate the Alfa DevTools extension.");
    }
  }
}

export const globalBrowserBridge = new BrowserBridge();
