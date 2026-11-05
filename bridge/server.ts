/**
 * Browser DevTools Bridge Server
 * 
 * Local WebSocket server that relays commands between MCP tools
 * and the Chrome/Edge extension. Binds to localhost only.
 */

import { WebSocketServer, WebSocket } from "ws";

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT ?? "9223", 10);
const BRIDGE_HOST = "127.0.0.1";

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

function log(msg: string): void {
  console.error(`[Bridge] ${msg}`);
}

function sendToExtension(request: BridgeRequest): void {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Extension not connected");
  }
  extensionSocket.send(JSON.stringify(request));
}

function sendToMcp(response: BridgeResponse): void {
  for (const sock of mcpSockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(response));
    }
  }
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

const wss = new WebSocketServer({ port: BRIDGE_PORT, host: BRIDGE_HOST });

wss.on("listening", () => {
  log(`Bridge server listening on ws://${BRIDGE_HOST}:${BRIDGE_PORT}`);
  log("Waiting for extension and MCP connections...");
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
        sendToExtension(msg);

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
    log("Client disconnected");
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
    log(`Port ${BRIDGE_PORT} already in use. Another bridge instance may be running.`);
    process.exit(1);
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down...");
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Shutting down...");
  wss.close();
  process.exit(0);
});
