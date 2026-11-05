/**
 * Browser DevTools Bridge Server
 * 
 * Local WebSocket server that relays commands between MCP tools
 * and the Chrome/Edge extension. Binds to localhost only.
 * Auto-starts with MCP server.
 */

import { WebSocketServer, WebSocket } from "ws";
import { loadRuntimeConfig } from "./runtimeConfig.js";

const BRIDGE_HOST = "127.0.0.1";

function getBridgePort(): number {
  return loadRuntimeConfig().bridgePort;
}

interface BridgeRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface BridgeResponse {
  id: string;
  type?: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

let extensionSocket: WebSocket | null = null;
let mcpSockets = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

function log(msg: string): void {
  console.error(`[BrowserBridge] ${msg}`);
}

function broadcastExtensionStatus(): void {
  const status = {
    type: "extension_status",
    id: "",
    success: !!extensionSocket,
    data: { connected: !!extensionSocket },
  };
  for (const sock of mcpSockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(status));
    }
  }
}

/**
 * Start the bridge server. Called automatically when MCP server starts.
 */
export function startBridgeServer(): void {
  if (wss) {
    log("Bridge server already running");
    return;
  }

  wss = new WebSocketServer({ port: getBridgePort(), host: BRIDGE_HOST });

  wss.on("listening", () => {
    log(`Bridge server listening on ws://${BRIDGE_HOST}:${getBridgePort()}`);
    log("Waiting for Chrome/Edge extension connection...");
  });

  wss.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress ?? "unknown";
    log(`New connection from ${clientIp}`);

    // Only allow localhost connections
    if (!clientIp.includes("127.0.0.1") && !clientIp.includes("::1") && !clientIp.includes("localhost")) {
      log(`Rejected non-localhost connection: ${clientIp}`);
      ws.close(1008, "Only localhost connections allowed");
      return;
    }

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as BridgeRequest & { role?: string };

        // Extension identifies itself on connect
        if (msg.role === "extension") {
          extensionSocket = ws;
          log("Extension connected");
          broadcastExtensionStatus();
          return;
        }

        // MCP tool request - forward to extension
        if (msg.id && msg.method) {
          if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
            const errorResponse: BridgeResponse = {
              id: msg.id,
              success: false,
              error: "Extension not connected. Please open the browser with the Alfa DevTools extension.",
            };
            ws.send(JSON.stringify(errorResponse));
            return;
          }

          // Forward to extension and relay response
          const handler = (extData: WebSocket.RawData) => {
            try {
              const extMsg = JSON.parse(String(extData)) as BridgeResponse;
              if (extMsg.id === msg.id) {
                extensionSocket?.removeListener("message", handler);
                ws.send(JSON.stringify(extMsg));
              }
            } catch {
              // ignore parse errors
            }
          };

          extensionSocket.on("message", handler);
          extensionSocket.send(JSON.stringify(msg));

          // Timeout: clean up listener after 30s
          setTimeout(() => {
            extensionSocket?.removeListener("message", handler);
          }, 30000);
        }
      } catch (err) {
        log(`Message parse error: ${err}`);
      }
    });

    ws.on("close", () => {
      mcpSockets.delete(ws);
      if (ws === extensionSocket) {
        extensionSocket = null;
        log("Extension disconnected");
        broadcastExtensionStatus();
      }
    });

    ws.on("error", (err) => {
      log(`WebSocket error: ${err.message}`);
    });

    // Assume MCP client if not extension
    mcpSockets.add(ws);
    broadcastExtensionStatus();
  });

  wss.on("error", (err) => {
    log(`Server error: ${err.message}`);
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      log(`Port ${getBridgePort()} already in use. Another bridge instance may be running.`);
    }
  });
}

/**
 * Stop the bridge server.
 */
export function stopBridgeServer(): void {
  if (wss) {
    log("Shutting down bridge server...");
    wss.close();
    wss = null;
    extensionSocket = null;
    mcpSockets.clear();
  }
}

/**
 * Get bridge server status.
 */
export function getBridgeStatus(): { running: boolean; extensionConnected: boolean; port: number } {
  return {
    running: !!wss,
    extensionConnected: !!extensionSocket,
    port: getBridgePort(),
  };
}
