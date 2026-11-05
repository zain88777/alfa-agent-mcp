// Redirect console.log to console.error to keep stdout clean for MCP JSON-RPC protocol
console.log = (...args: unknown[]) => { console.error(...args); };

import express from "express";
import cors from "cors";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { initSystem } from "./core/initSystem.js";
import { loadRuntimeConfig } from "./core/runtimeConfig.js";
import { OAuthServer } from "./core/oauthServer.js";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { configureScreenBridgeFromRuntime } from "./core/electronScreenBridge.js";
import { startBridgeServer, stopBridgeServer } from "./core/browserBridgeServer.js";

function loadLocalDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    const value = trimmed.slice(eq + 1).trim();
    process.env[key] = value;
  }
}

loadLocalDotEnv();

const { registry } = initSystem();
const runtimeConfig = loadRuntimeConfig();
configureScreenBridgeFromRuntime(runtimeConfig);
const MCP_API_TOKEN = runtimeConfig.mcp.apiToken;
const MCP_DISABLE_AUTH = runtimeConfig.mcp.disableAuth;
const oauthServer = new OAuthServer({
  issuer: runtimeConfig.oauth.issuer ?? "",
  authPath: "/oauth/authorize",
  tokenPath: "/oauth/token",
  registrationPath: "/oauth/register",
  userinfoPath: "/oauth/userinfo",
  metadataPath: "/.well-known/oauth-authorization-server",
  jwksPath: "/.well-known/jwks.json",
  approvedClientIds: runtimeConfig.oauth.approvedClientIds,
  accessTokenTtlSec: runtimeConfig.oauth.accessTokenTtlSec,
  authCodeTtlSec: runtimeConfig.oauth.authCodeTtlSec,
  statePath: runtimeConfig.oauth.statePath,
});

const HTTP_PORT = 3000;

type ToolDef = ReturnType<typeof registry.listDefinitions>[number];

const toolDefs = registry.listDefinitions();
console.error(`[AlfaDev][Startup] active registry instance: ${registry.instanceId}`);

console.error(`[AlfaDev] Registering ${toolDefs.length} tools: ${
  toolDefs.slice(0, 10).map((t) => t.name).join(", ")
}${toolDefs.length > 10 ? ", ..." : ""}`);

const schematizedCount = toolDefs.filter((t) => t.schema).length;
console.error(`[AlfaDev] Schemas defined for ${schematizedCount}/${toolDefs.length} tools`);

/**
 * Sensitive field names to redact from logs.
 * Any input field whose name contains one of these substrings will be masked.
 */
const SENSITIVE_KEYS = [
  "apikey", "api_key", "api-key",
  "token", "auth", "authorization",
  "password", "passwd", "secret",
  "credential", "privatekey", "private_key",
  "api", "key",
];

/**
 * Recursively redact sensitive fields from an input object for safe logging.
 */
function redactInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;

  if (Array.isArray(input)) {
    return input.map(redactInput);
  }

  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const keyLower = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sk) => keyLower.includes(sk))) {
      copy[key] = "***REDACTED***";
    } else if (typeof value === "object" && value !== null) {
      copy[key] = redactInput(value);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

function registerTools(server: McpServer, defs: ToolDef[]): void {
  for (const def of defs) {
    const inputSchema = def.schema || z.object({}).catchall(z.any());

    server.registerTool(
      def.name,
      {
        description: def.description || `Tool: ${def.name}`,
        inputSchema,
      },
      async (input) => {
        const debugMode = runtimeConfig.debugMode;
        const loggedInput = debugMode ? input : redactInput(input);
        console.error(`[AlfaDev] Tool "${def.name}" received input:`, JSON.stringify(loggedInput));

        const result = await registry.execute(def.name, input);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );
  }
}

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "alfa-dev-os",
    version: "3.0.0",
  });
  registerTools(server, toolDefs);
  return server;
}

function requireMcpBearerToken(req: Request, res: Response, next: NextFunction): void {
  if (MCP_DISABLE_AUTH) {
    next();
    return;
  }
  const authHeader = req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) {
    sendMcpUnauthorizedWithChallenge(req, res, "Missing bearer token");
    return;
  }
  if ((MCP_API_TOKEN && token === MCP_API_TOKEN) || oauthServer.validateAccessToken(token)) {
    next();
    return;
  }
  sendMcpUnauthorizedWithChallenge(req, res, "Invalid bearer token");
}

function getPublicOrigin(req: Request): string {
  if (runtimeConfig.oauth.issuer) {
    try {
      return new URL(runtimeConfig.oauth.issuer).origin;
    } catch {
      // fallback below
    }
  }
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  const cfVisitor = req.get("cf-visitor");
  let protocol = req.get("x-forwarded-proto") || req.protocol;
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed.scheme) protocol = parsed.scheme;
    } catch {
      // ignore malformed cf-visitor header
    }
  }
  if (!protocol) protocol = "http";
  return `${protocol}://${host}`;
}

function sendMcpUnauthorizedWithChallenge(req: Request, res: Response, reason: string): void {
  const origin = getPublicOrigin(req);
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource`;
  const challenge = `Bearer error="invalid_token", error_description="${reason}", resource_metadata="${resourceMetadata}"`;
  res.setHeader("WWW-Authenticate", challenge);
  res.status(401).json({
    error: {
      code: "UNAUTHORIZED",
      message: "Missing or invalid bearer token.",
    },
  });
}

function normalizeMcpAcceptHeader(req: Request): void {
  // Do not override explicit client preferences. Some MCP clients rely on
  // strict Accept negotiation and may fail if we force SSE.
  const acceptHeader = String(req.headers.accept ?? "").trim();
  if (!acceptHeader) {
    req.headers.accept = "application/json, text/event-stream";
  }
}

async function startStdioServer(): Promise<void> {
  const stdioServer = buildMcpServer();
  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);
  console.error(`[AlfaDev][Startup] stdio registry attached: ${registry.instanceId}`);
  console.error("[AlfaDev] MCP server running on stdio");
}

export function createHttpApp(): express.Express {
  const app = express();
  const httpTransports = new Map<string, StreamableHTTPServerTransport>();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (!req.path.startsWith("/mcp")) return;
      const sessionId = String(req.header("mcp-session-id") ?? "").trim() || "-";
      const accept = String(req.headers.accept ?? "-");
      const hasAuth = String(req.headers.authorization ?? "").startsWith("Bearer ");
      console.error(
        `[AlfaDev][mcp] ${req.method.toUpperCase()} ${req.path} status=${res.statusCode} session=${sessionId} auth=${hasAuth} accept="${accept}" ms=${Date.now() - started}`,
      );
    });
    next();
  });

  app.get("/", (_req, res) => {
    res.status(200).json({
      ok: true,
      name: "alfa-dev-os",
      version: "3.0.0",
      authMode: MCP_DISABLE_AUTH ? "noauth" : "bearer_or_oauth",
      transport: {
        stdio: true,
        http: true,
      },
      endpoint: "/mcp",
      tools: toolDefs.length,
    });
  });

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.status(200).json(oauthServer.getMetadata(req));
  });
  app.get("/.well-known/openid-configuration", (req, res) => {
    res.status(200).json(oauthServer.getOpenIdConfiguration(req));
  });
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.status(200).json(oauthServer.getProtectedResourceMetadata(req));
  });
  app.get("/.well-known/jwks.json", (_req, res) => {
    res.status(200).json({ keys: [] });
  });
  app.post("/oauth/register", (req, res) => oauthServer.handleRegister(req, res));
  app.get("/oauth/authorize", (req, res) => oauthServer.handleAuthorize(req, res));
  app.post("/oauth/token", (req, res) => oauthServer.handleToken(req, res));
  app.get("/oauth/userinfo", (req, res) => oauthServer.handleUserInfo(req, res));

  app.use("/mcp", (req, _res, next) => {
    normalizeMcpAcceptHeader(req);
    next();
  });
  app.all("/mcp", async (req, res) => {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      });
      return;
    }

    const rpcMethod = typeof req.body?.method === "string" ? req.body.method : "";
    const isBootstrapNoAuth = method === "POST" && (rpcMethod === "initialize" || rpcMethod === "tools/list");
    if (!isBootstrapNoAuth) {
      let authorized = false;
      await new Promise<void>((resolve) => {
        requireMcpBearerToken(req, res, () => {
          authorized = true;
          resolve();
        });
        if (!authorized) resolve();
      });
      if (!authorized) return;
    }

    const requestedSessionId = String(req.header("mcp-session-id") ?? "").trim();
    if (method === "GET" && !requestedSessionId) {
      // Compatibility endpoint for connector validators that probe the MCP URL
      // with a plain GET before starting JSON-RPC session bootstrap.
      res.status(200).json({
        ok: true,
        name: "alfa-dev-os",
        version: "3.0.0",
        authMode: MCP_DISABLE_AUTH ? "noauth" : "bearer_or_oauth",
        endpoint: "/mcp",
        transport: "streamable-http",
        message: "Use POST initialize to start an MCP session.",
      });
      return;
    }
    let transport: StreamableHTTPServerTransport | undefined;

    if (requestedSessionId) {
      transport = httpTransports.get(requestedSessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unknown MCP session.",
          },
          id: null,
        });
        return;
      }
    } else if (method === "POST") {
      const httpServer = buildMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      transport.onclose = async () => {
        if (transport?.sessionId) httpTransports.delete(transport.sessionId);
        await httpServer.close();
      };
      await httpServer.connect(transport);
      console.error(`[AlfaDev][Startup] HTTP registry attached: ${registry.instanceId}`);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32002,
          message: "Missing mcp-session-id.",
        },
        id: null,
      });
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
      if (transport.sessionId) {
        httpTransports.set(transport.sessionId, transport);
      }
    } catch (error) {
      console.error("[AlfaDev] HTTP MCP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/global/health", async (_req, res) => {
    try {
      const health = registry.getHealthSnapshot();
      res.status(200).json({
        ok: true,
        name: "alfa-dev-os",
        version: "3.0.0",
        endpoint: "/mcp",
        tools: toolDefs.length,
        status: health.status,
      });
    } catch {
      res.status(200).json({
        ok: true,
        name: "alfa-dev-os",
        version: "3.0.0",
        endpoint: "/mcp",
        tools: toolDefs.length,
        status: "unknown",
      });
    }
  });

  return app;
}

function startHttpServer(): void {
  const app = createHttpApp();
  app.listen(HTTP_PORT, () => {
    console.error(`[AlfaDev] MCP server running on HTTP http://localhost:${HTTP_PORT}/mcp`);
  });
}

async function start(): Promise<void> {
  // Start browser DevTools bridge server (WebSocket on port 9223)
  startBridgeServer();
  
  await startStdioServer();
  startHttpServer();
}

// Graceful shutdown
process.on("SIGINT", () => {
  stopBridgeServer();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopBridgeServer();
  process.exit(0);
});

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  start().catch((err) => {
    console.error("[AlfaDev] Failed to start server:", err);
    process.exit(1);
  });
}
