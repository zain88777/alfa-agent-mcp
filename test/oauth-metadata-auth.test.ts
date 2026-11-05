import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let server: Server | null = null;
let baseUrl = "";
let oauthStatePath = "";

async function boot() {
  const mod = await import(`../src/index.js?testCacheBust=${Date.now()}_${Math.random()}`);
  const app = mod.createHttpApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function shutdown() {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((err) => (err ? reject(err) : resolve()));
  });
  server = null;
}

describe("oauth discovery + mcp auth", () => {
  beforeEach(async () => {
    process.env.MCP_API_TOKEN = "test-token-placeholder";
    process.env.MCP_OAUTH_APPROVED_CLIENT_IDS = "";
    delete process.env.MCP_OAUTH_ISSUER;
    delete process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SEC;
    delete process.env.MCP_OAUTH_AUTH_CODE_TTL_SEC;
    process.env.ENABLE_SCREEN_AGENT = "true";
    oauthStatePath = path.join(os.tmpdir(), `alfa-oauth-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    process.env.MCP_OAUTH_STATE_PATH = oauthStatePath;
    await boot();
  });

  afterEach(async () => {
    await shutdown();
    try {
      if (oauthStatePath && fs.existsSync(oauthStatePath)) {
        fs.unlinkSync(oauthStatePath);
      }
    } catch {
      // no-op for test cleanup
    }
  });

  it("OAuth metadata discovery", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    assert.equal(res.status, 200);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(typeof data.authorization_endpoint, "string");
    assert.equal(typeof data.token_endpoint, "string");
    assert.deepEqual(data.token_endpoint_auth_methods_supported, ["none", "private_key_jwt"]);
    assert.equal(Object.prototype.hasOwnProperty.call(data, "userinfo_endpoint"), false);
  });

  it("OAuth protected resource metadata discovery", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 200);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(typeof data.resource, "string");
    assert.ok(String(data.resource).endsWith("/mcp"));
    assert.equal(Array.isArray(data.authorization_servers), true);
    assert.equal(Array.isArray(data.scopes_supported), true);
  });

  it("Cloudflare/proxy https issuer behavior uses MCP_OAUTH_ISSUER as canonical base", async () => {
    await shutdown();
    process.env.MCP_OAUTH_ISSUER = "https://mcp.alfatek.store";
    await boot();

    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    assert.equal(res.status, 200);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.issuer, "https://mcp.alfatek.store");
    assert.equal(data.authorization_endpoint, "https://mcp.alfatek.store/oauth/authorize");
    assert.equal(data.token_endpoint, "https://mcp.alfatek.store/oauth/token");
    assert.equal(data.jwks_uri, "https://mcp.alfatek.store/.well-known/jwks.json");

    const oidcRes = await fetch(`${baseUrl}/.well-known/openid-configuration`);
    assert.equal(oidcRes.status, 200);
    const oidc = await oidcRes.json() as Record<string, unknown>;
    assert.equal(oidc.issuer, "https://mcp.alfatek.store");
    assert.equal(oidc.authorization_endpoint, "https://mcp.alfatek.store/oauth/authorize");
    assert.equal(oidc.token_endpoint, "https://mcp.alfatek.store/oauth/token");
    assert.equal(oidc.jwks_uri, "https://mcp.alfatek.store/.well-known/jwks.json");
  });

  it("token issuance", async () => {
    const redirectUri = "https://example.com/callback";
    const authRes = await fetch(`${baseUrl}/oauth/authorize?response_type=code&client_id=my-client&redirect_uri=${encodeURIComponent(redirectUri)}&state=abc`, {
      redirect: "manual",
    });
    assert.equal(authRes.status, 302);
    const location = authRes.headers.get("location");
    assert.ok(location);
    const code = new URL(location!).searchParams.get("code");
    assert.ok(code);

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: "my-client",
        redirect_uri: redirectUri,
      }),
    });
    assert.equal(tokenRes.status, 200);
    const tokenBody = await tokenRes.json() as Record<string, unknown>;
    assert.equal(typeof tokenBody.access_token, "string");
  });

  it("approved client list enforces User-Defined OAuth Client ID", async () => {
    await shutdown();
    process.env.MCP_OAUTH_APPROVED_CLIENT_IDS = "chatgpt";
    await boot();

    const redirectUri = "https://example.com/callback";
    const denied = await fetch(`${baseUrl}/oauth/authorize?response_type=code&client_id=other-client&redirect_uri=${encodeURIComponent(redirectUri)}`, {
      redirect: "manual",
    });
    assert.equal(denied.status, 403);

    const allowed = await fetch(`${baseUrl}/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=${encodeURIComponent(redirectUri)}`, {
      redirect: "manual",
    });
    assert.equal(allowed.status, 302);
  });

  it("/mcp accepts OAuth access token", async () => {
    const redirectUri = "https://example.com/callback";
    const authRes = await fetch(`${baseUrl}/oauth/authorize?response_type=code&client_id=my-client&redirect_uri=${encodeURIComponent(redirectUri)}`, {
      redirect: "manual",
    });
    const location = authRes.headers.get("location");
    const code = new URL(location!).searchParams.get("code");
    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: "my-client",
        redirect_uri: redirectUri,
      }),
    });
    const tokenBody = await tokenRes.json() as Record<string, unknown>;
    const accessToken = tokenBody.access_token as string;

    const mcpRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.notEqual(mcpRes.status, 401);
  });

  it("/mcp still accepts MCP_API_TOKEN", async () => {
    const mcpRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-placeholder",
      },
      body: JSON.stringify({}),
    });
    assert.notEqual(mcpRes.status, 401);
  });

  it("invalid token rejected", async () => {
    const mcpRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({}),
    });
    assert.equal(mcpRes.status, 401);
    const challenge = mcpRes.headers.get("www-authenticate") || "";
    assert.ok(challenge.toLowerCase().startsWith("bearer "));
    assert.ok(challenge.includes("resource_metadata="));
  });

  it("mixed-auth bootstrap allows unauth initialize and tools/list, but denies tools/call", async () => {
    const initializeRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    assert.equal(initializeRes.status, 200);
    const sessionId = initializeRes.headers.get("mcp-session-id");
    assert.ok(sessionId);

    const listRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(listRes.status, 200);

    const callRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "list_files",
          arguments: {},
        },
      }),
    });
    assert.equal(callRes.status, 401);
  });

  it("DCR client is accepted by authorize, redirect mismatch fails, unknown client is unauthorized", async () => {
    await shutdown();
    process.env.MCP_OAUTH_APPROVED_CLIENT_IDS = "manually-approved-static-client";
    await boot();

    const redirectUri = "https://chatgpt.com/connector/oauth/callback-ok";
    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const dcrClientId = String(registerBody.client_id ?? "");
    assert.ok(dcrClientId.startsWith("chatgpt_"));

    const okAuthorize = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(dcrClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=s1`,
      { redirect: "manual" },
    );
    assert.equal(okAuthorize.status, 302);

    const badRedirectAuthorize = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(dcrClientId)}&redirect_uri=${encodeURIComponent("https://chatgpt.com/connector/oauth/wrong")}&state=s2`,
      { redirect: "manual" },
    );
    assert.equal(badRedirectAuthorize.status, 400);

    const unknownClientAuthorize = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent("chatgpt_unknown_runtime_client")}&redirect_uri=${encodeURIComponent(redirectUri)}&state=s3`,
      { redirect: "manual" },
    );
    assert.equal(unknownClientAuthorize.status, 403);
    const unknownBody = await unknownClientAuthorize.json() as Record<string, unknown>;
    assert.equal(unknownBody.error, "unauthorized_client");
  });

  it("full OAuth DCR + PKCE + MCP flow", async () => {
    await shutdown();
    process.env.MCP_OAUTH_APPROVED_CLIENT_IDS = "manual-only-static-client";
    await boot();

    const redirectUri = "https://chatgpt.com/connector/oauth/final-callback";
    const verifier = "pkce-verifier-very-long-value-1234567890";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = "state-xyz-123";

    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const clientId = String(registerBody.client_id ?? "");
    assert.ok(clientId.startsWith("chatgpt_"));

    const authorizeRes = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    assert.equal(authorizeRes.status, 302);
    const location = authorizeRes.headers.get("location");
    assert.ok(location);
    const redirect = new URL(location!);
    const code = redirect.searchParams.get("code");
    assert.ok(code);
    assert.equal(redirect.searchParams.get("state"), state);

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(tokenRes.status, 200);
    const tokenContentType = tokenRes.headers.get("content-type") || "";
    assert.ok(tokenContentType.toLowerCase().includes("application/json"));
    const tokenBody = await tokenRes.json() as Record<string, unknown>;
    assert.equal(typeof tokenBody.access_token, "string");
    assert.equal(tokenBody.token_type, "Bearer");
    assert.equal(typeof tokenBody.expires_in, "number");

    const reusedCodeRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(reusedCodeRes.status, 400);
    const reusedBody = await reusedCodeRes.json() as Record<string, unknown>;
    assert.equal(reusedBody.error, "invalid_grant");

    const accessToken = String(tokenBody.access_token);
    const mcpRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.notEqual(mcpRes.status, 401);
  });

  it("DCR client survives restart and can authorize", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/final-callback";
    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const clientId = String(registerBody.client_id ?? "");
    assert.ok(clientId.startsWith("chatgpt_"));

    await shutdown();
    await boot();

    const authorizeRes = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=survive-restart`,
      { redirect: "manual" },
    );
    assert.equal(authorizeRes.status, 302);
  });

  it("authorization code exchange is single-use and expired code/token are rejected", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/final-callback";
    const verifier = "pkce-verifier-very-long-value-1234567890";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const clientId = String(registerBody.client_id ?? "");

    const authorizeRes = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=s1&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    assert.equal(authorizeRes.status, 302);
    const code = new URL(authorizeRes.headers.get("location")!).searchParams.get("code");
    assert.ok(code);

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(tokenRes.status, 200);
    const tokenBody = await tokenRes.json() as Record<string, unknown>;
    const accessToken = String(tokenBody.access_token ?? "");
    assert.ok(accessToken.length > 10);

    const reused = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(reused.status, 400);

    const stateAfterToken = JSON.parse(fs.readFileSync(oauthStatePath, "utf8")) as {
      accessTokens?: Array<{ token?: string; expiresAt?: number }>;
    };
    for (const t of stateAfterToken.accessTokens ?? []) {
      if (t.token === accessToken) t.expiresAt = Date.now() - 1000;
    }
    fs.writeFileSync(oauthStatePath, JSON.stringify(stateAfterToken, null, 2), "utf8");

    await shutdown();
    await boot();

    const mcpRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(mcpRes.status, 401);

    const authorizeExpiredCode = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=s2&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    assert.equal(authorizeExpiredCode.status, 302);
    const soonExpiredCode = new URL(authorizeExpiredCode.headers.get("location")!).searchParams.get("code");
    assert.ok(soonExpiredCode);
    const stateAfterCode = JSON.parse(fs.readFileSync(oauthStatePath, "utf8")) as {
      authCodes?: Array<{ code?: string; expiresAt?: number }>;
    };
    for (const c of stateAfterCode.authCodes ?? []) {
      if (c.code === soonExpiredCode) c.expiresAt = Date.now() - 1000;
    }
    fs.writeFileSync(oauthStatePath, JSON.stringify(stateAfterCode, null, 2), "utf8");

    await shutdown();
    await boot();
    const expiredCodeExchange = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(soonExpiredCode),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(expiredCodeExchange.status, 400);
  });

  it("authorization code survives restart and can be exchanged within TTL", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/final-callback";
    const verifier = "pkce-verifier-very-long-value-1234567890";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const clientId = String(registerBody.client_id ?? "");

    const authorizeRes = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=restart-code&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    assert.equal(authorizeRes.status, 302);
    const code = new URL(authorizeRes.headers.get("location")!).searchParams.get("code");
    assert.ok(code);

    await shutdown();
    await boot();

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(tokenRes.status, 200);
  });

  it("register creates oauth-state.json and stores client", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/final-callback";
    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const clientId = String(registerBody.client_id ?? "");
    assert.ok(clientId.startsWith("chatgpt_"));

    assert.equal(fs.existsSync(oauthStatePath), true);
    const stateFile = JSON.parse(fs.readFileSync(oauthStatePath, "utf8")) as {
      registeredClients?: Array<{ clientId?: string }>;
    };
    assert.equal(Array.isArray(stateFile.registeredClients), true);
    assert.equal((stateFile.registeredClients ?? []).some((c) => c.clientId === clientId), true);
  });

  it("authorize persists auth code and token exchange persists access token while consuming code", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/final-callback";
    const verifier = "pkce-verifier-very-long-value-1234567890";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const clientId = String(registerBody.client_id ?? "");

    const authorizeRes = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=persist-check&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    assert.equal(authorizeRes.status, 302);
    const code = new URL(authorizeRes.headers.get("location")!).searchParams.get("code");
    assert.ok(code);

    const afterAuthorize = JSON.parse(fs.readFileSync(oauthStatePath, "utf8")) as {
      authCodes?: Array<{ code?: string; used?: boolean }>;
    };
    const persistedCode = (afterAuthorize.authCodes ?? []).find((item) => item.code === code);
    assert.ok(persistedCode);
    assert.equal(persistedCode?.used, false);

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(tokenRes.status, 200);
    const tokenBody = await tokenRes.json() as Record<string, unknown>;
    const accessToken = String(tokenBody.access_token ?? "");
    assert.ok(accessToken.length > 10);

    const afterToken = JSON.parse(fs.readFileSync(oauthStatePath, "utf8")) as {
      authCodes?: Array<{ code?: string; used?: boolean }>;
      accessTokens?: Array<{ token?: string }>;
    };
    const consumedCode = (afterToken.authCodes ?? []).find((item) => item.code === code);
    assert.ok(consumedCode);
    assert.equal(consumedCode?.used, true);
    assert.equal((afterToken.accessTokens ?? []).some((item) => item.token === accessToken), true);
  });

  it("CIMD private_key_jwt metadata is accepted at authorize time", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/cimd-callback";
    const clientId = `https://cimd-client.example.test/cimd-client-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url === clientId) {
        return new Response(JSON.stringify({
          client_id: clientId,
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "private_key_jwt",
          jwks_uri: "https://chatgpt.com/oauth/jwks.json",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const authorizeRes = await fetch(
        `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=cimd-private-jwt`,
        { redirect: "manual" },
      );
      assert.equal(authorizeRes.status, 302);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("CIMD unsupported auth method is rejected", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/cimd-callback";
    const clientId = `https://cimd-client.example.test/cimd-client-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url === clientId) {
        return new Response(JSON.stringify({
          client_id: clientId,
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "client_secret_post",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const authorizeRes = await fetch(
        `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=cimd-unsupported`,
        { redirect: "manual" },
      );
      assert.equal(authorizeRes.status, 400);
      const body = await authorizeRes.json() as Record<string, unknown>;
      assert.equal(body.error, "invalid_client");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("private_key_jwt client reaches token endpoint and returns explicit temporary reason", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/cimd-callback";
    const clientId = `https://cimd-client.example.test/cimd-client-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url === clientId) {
        return new Response(JSON.stringify({
          client_id: clientId,
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "private_key_jwt",
          jwks_uri: "https://chatgpt.com/oauth/jwks.json",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const authorizeRes = await fetch(
        `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=safe-mode`,
        { redirect: "manual" },
      );
      assert.equal(authorizeRes.status, 302);
      const code = new URL(authorizeRes.headers.get("location")!).searchParams.get("code");
      assert.ok(code);

      const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: "placeholder.jwt.value",
        }),
      });
      assert.equal(tokenRes.status, 401);
      const tokenBody = await tokenRes.json() as Record<string, unknown>;
      assert.equal(tokenBody.error, "invalid_client");
      assert.equal(tokenBody.error_description, "private_key_jwt_not_implemented");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("token request with mismatched resource is rejected", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/final-callback";
    const registerRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json() as Record<string, unknown>;
    const clientId = String(registerBody.client_id ?? "");

    const resourceA = "https://mcp.alfatek.store/mcp";
    const resourceB = "https://mcp.alfatek.store/other";
    const authorizeRes = await fetch(
      `${baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=resource-test&resource=${encodeURIComponent(resourceA)}`,
      { redirect: "manual" },
    );
    assert.equal(authorizeRes.status, 302);
    const code = new URL(authorizeRes.headers.get("location")!).searchParams.get("code");
    assert.ok(code);

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        resource: resourceB,
      }),
    });
    assert.equal(tokenRes.status, 400);
    const body = await tokenRes.json() as Record<string, unknown>;
    assert.equal(body.error, "invalid_grant");
  });
});
