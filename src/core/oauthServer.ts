import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";

interface AuthCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  tokenEndpointAuthMethod?: "none" | "client_secret_post" | "private_key_jwt";
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
  scope: string;
  resource?: string;
  expiresAt: number;
  used: boolean;
}

interface AccessTokenRecord {
  token: string;
  clientId: string;
  scope: string;
  resource?: string;
  expiresAt: number;
}

interface RegisteredClientRecord {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: "none" | "client_secret_post" | "private_key_jwt";
  grantTypes: string[];
  responseTypes: string[];
  jwksUri?: string;
  jwks?: unknown;
  createdAt: number;
}

interface CimdClientMetadata {
  client_id: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  jwks_uri?: string;
  jwks?: unknown;
}

interface OAuthRuntimeStore {
  authCodes: Map<string, AuthCodeRecord>;
  accessTokens: Map<string, AccessTokenRecord>;
  registeredClients: Map<string, RegisteredClientRecord>;
  cimdClients: Map<string, RegisteredClientRecord>;
}

const oauthRuntimeStore: OAuthRuntimeStore = {
  authCodes: new Map<string, AuthCodeRecord>(),
  accessTokens: new Map<string, AccessTokenRecord>(),
  registeredClients: new Map<string, RegisteredClientRecord>(),
  cimdClients: new Map<string, RegisteredClientRecord>(),
};

interface OAuthPersistedStateV1 {
  version: 1;
  updatedAt: string;
  authCodes: AuthCodeRecord[];
  accessTokens: AccessTokenRecord[];
  registeredClients: RegisteredClientRecord[];
  cimdClients: RegisteredClientRecord[];
}

export interface OAuthConfig {
  issuer: string;
  authPath: string;
  tokenPath: string;
  registrationPath: string;
  userinfoPath: string;
  metadataPath: string;
  jwksPath: string;
  approvedClientIds: string[];
  accessTokenTtlSec: number;
  authCodeTtlSec: number;
  statePath?: string;
}

function randomOpaque(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function oauthLog(event: string, fields: Record<string, unknown>): void {
  console.error(`[AlfaDev][oauth] ${JSON.stringify({ event, ...fields })}`);
}

function normalizeScope(raw: string): string {
  const supported = new Set(["mcp", "openid", "profile", "email"]);
  const requested = raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => supported.has(s));
  if (requested.length === 0) return "mcp";
  if (!requested.includes("mcp")) requested.push("mcp");
  return [...new Set(requested)].join(" ");
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStatePath = path.resolve(moduleDir, "..", "..", ".alfa-agent", "oauth-state.json");

export class OAuthServer {
  private readonly config: OAuthConfig;
  private readonly authCodes = oauthRuntimeStore.authCodes;
  private readonly accessTokens = oauthRuntimeStore.accessTokens;
  private readonly registeredClients = oauthRuntimeStore.registeredClients;
  private readonly cimdClients = oauthRuntimeStore.cimdClients;
  private readonly statePath: string;

  constructor(config: OAuthConfig) {
    this.config = config;
    this.statePath = path.resolve(config.statePath || defaultStatePath);
    this.loadStateFromDisk();
  }

  private loadStateFromDisk(): void {
    try {
      if (!fs.existsSync(this.statePath)) {
        oauthLog("oauth_state_loaded", { path: this.statePath, exists: false });
        return;
      }
      const raw = fs.readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<OAuthPersistedStateV1>;
      const authCodes = Array.isArray(parsed.authCodes) ? parsed.authCodes : [];
      const accessTokens = Array.isArray(parsed.accessTokens) ? parsed.accessTokens : [];
      const registeredClients = Array.isArray(parsed.registeredClients) ? parsed.registeredClients : [];
      const cimdClients = Array.isArray(parsed.cimdClients) ? parsed.cimdClients : [];

      this.authCodes.clear();
      for (const item of authCodes) {
        if (item?.code) this.authCodes.set(item.code, item);
      }
      this.accessTokens.clear();
      for (const item of accessTokens) {
        if (item?.token) this.accessTokens.set(item.token, item);
      }
      this.registeredClients.clear();
      for (const item of registeredClients) {
        if (item?.clientId) this.registeredClients.set(item.clientId, item);
      }
      this.cimdClients.clear();
      for (const item of cimdClients) {
        if (item?.clientId) this.cimdClients.set(item.clientId, item);
      }

      oauthLog("oauth_state_loaded", {
        path: this.statePath,
        exists: true,
        clients: this.registeredClients.size,
        authCodes: this.authCodes.size,
        accessTokens: this.accessTokens.size,
        registeredClients: this.registeredClients.size,
        cimdClients: this.cimdClients.size,
      });
      oauthLog("oauth_registered_client_loaded", {
        count: this.registeredClients.size,
        path: this.statePath,
      });
    } catch (error) {
      oauthLog("oauth_state_load_failed", { path: this.statePath, error: error instanceof Error ? error.message : "unknown" });
    }
  }

  private persistState(reason: string): void {
    try {
      const dir = path.dirname(this.statePath);
      fs.mkdirSync(dir, { recursive: true });
      const snapshot: OAuthPersistedStateV1 = {
        version: 1,
        updatedAt: new Date().toISOString(),
        authCodes: [...this.authCodes.values()],
        accessTokens: [...this.accessTokens.values()],
        registeredClients: [...this.registeredClients.values()],
        cimdClients: [...this.cimdClients.values()],
      };
      const tmpPath = `${this.statePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf8");
      fs.renameSync(tmpPath, this.statePath);
      oauthLog("oauth_state_saved", {
        path: this.statePath,
        reason,
        authCodes: snapshot.authCodes.length,
        accessTokens: snapshot.accessTokens.length,
        registeredClients: snapshot.registeredClients.length,
        cimdClients: snapshot.cimdClients.length,
      });
      oauthLog("oauth_registered_client_saved", {
        count: snapshot.registeredClients.length,
        path: this.statePath,
      });
    } catch (error) {
      oauthLog("oauth_state_save_failed", {
        path: this.statePath,
        reason,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  private gc(): void {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of this.authCodes.entries()) {
      if (v.expiresAt <= now || v.used) {
        this.authCodes.delete(k);
        changed = true;
      }
    }
    for (const [k, v] of this.accessTokens.entries()) {
      if (v.expiresAt <= now) {
        this.accessTokens.delete(k);
        changed = true;
      }
    }
    if (changed) {
      this.persistState("gc_cleanup");
    }
  }

  private isClientApproved(clientId: string): boolean {
    if (this.registeredClients.has(clientId)) return true;
    if (this.config.approvedClientIds.length === 0) return true;
    return this.config.approvedClientIds.includes(clientId);
  }

  private getRegisteredClient(clientId: string): RegisteredClientRecord | undefined {
    return this.registeredClients.get(clientId) || this.cimdClients.get(clientId);
  }

  private logEndpoint(
    event: string,
    req: Request,
    fields: {
      clientId?: string;
      redirectUri?: string;
      grantType?: string;
      hasCodeVerifier?: boolean;
      reason?: string;
      status?: number;
    } = {},
  ): void {
    oauthLog(event, {
      method: req.method,
      client_id: fields.clientId ?? null,
      redirect_uri: fields.redirectUri ?? null,
      grant_type: fields.grantType ?? null,
      has_code_verifier: fields.hasCodeVerifier ?? null,
      reason: fields.reason ?? null,
      status: fields.status ?? null,
    });
  }

  private isHttpsUrl(value: string): boolean {
    try {
      const u = new URL(value);
      return u.protocol === "https:";
    } catch {
      return false;
    }
  }

  private async resolveCimdClient(clientId: string): Promise<RegisteredClientRecord> {
    const cached = this.cimdClients.get(clientId);
    if (cached) return cached;

    if (!this.isHttpsUrl(clientId)) {
      throw new Error("invalid_client");
    }

    const res = await fetch(clientId, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error("invalid_client_metadata");
    }

    const body = await res.json() as CimdClientMetadata;
    if (!body || typeof body !== "object") {
      throw new Error("invalid_client_metadata");
    }

    if (String(body.client_id ?? "") !== clientId) {
      throw new Error("invalid_client_metadata");
    }

    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map((v) => String(v)) : [];
    if (redirectUris.length === 0) {
      throw new Error("invalid_client_metadata");
    }

    const authMethodRaw = String(body.token_endpoint_auth_method ?? "none");
    // For ChatGPT CIMD, allow public or signed assertion clients.
    if (authMethodRaw !== "none" && authMethodRaw !== "private_key_jwt") {
      throw new Error("invalid_client_metadata");
    }
    if (authMethodRaw === "private_key_jwt" && !body.jwks_uri && !body.jwks) {
      throw new Error("invalid_client_metadata");
    }

    const record: RegisteredClientRecord = {
      clientId,
      redirectUris,
      tokenEndpointAuthMethod: authMethodRaw as "none" | "private_key_jwt",
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      jwksUri: typeof body.jwks_uri === "string" ? body.jwks_uri : undefined,
      jwks: body.jwks,
      createdAt: Date.now(),
    };
    this.cimdClients.set(clientId, record);
    this.persistState("oauth_cimd_resolve");
    return record;
  }

  private getPublicOrigin(req: Request): string {
    if (this.config.issuer) {
      try {
        return new URL(this.config.issuer).origin;
      } catch {
        // Fallback to request-derived origin if issuer is malformed.
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

  getMetadata(req: Request): Record<string, unknown> {
    const origin = this.getPublicOrigin(req);
    const issuer = this.config.issuer || origin;
    return {
      issuer,
      authorization_endpoint: `${origin}${this.config.authPath}`,
      token_endpoint: `${origin}${this.config.tokenPath}`,
      registration_endpoint: `${origin}${this.config.registrationPath}`,
      jwks_uri: `${origin}${this.config.jwksPath}`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      code_challenge_methods_supported: ["S256", "plain"],
      scopes_supported: ["mcp", "openid", "profile", "email"],
      client_id_metadata_document_supported: true,
    };
  }

  getOpenIdConfiguration(req: Request): Record<string, unknown> {
    const origin = this.getPublicOrigin(req);
    const issuer = this.config.issuer || origin;
    return {
      issuer,
      authorization_endpoint: `${origin}${this.config.authPath}`,
      token_endpoint: `${origin}${this.config.tokenPath}`,
      userinfo_endpoint: `${origin}${this.config.userinfoPath}`,
      registration_endpoint: `${origin}${this.config.registrationPath}`,
      jwks_uri: `${origin}${this.config.jwksPath}`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      code_challenge_methods_supported: ["S256", "plain"],
      scopes_supported: ["mcp", "openid", "profile", "email"],
      client_id_metadata_document_supported: true,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["none"],
    };
  }

  getProtectedResourceMetadata(req: Request, resourcePath = "/mcp"): Record<string, unknown> {
    const origin = this.getPublicOrigin(req);
    const issuer = this.config.issuer || origin;
    return {
      resource: `${origin}${resourcePath}`,
      authorization_servers: [issuer],
      scopes_supported: ["mcp", "openid", "profile", "email"],
      bearer_methods_supported: ["header"],
    };
  }

  handleRegister(req: Request, res: Response): void {
    this.gc();
    const redirectUrisRaw = req.body?.redirect_uris;
    const tokenEndpointAuthMethodRaw = String(req.body?.token_endpoint_auth_method ?? "none");
    const grantTypesRaw = Array.isArray(req.body?.grant_types) ? req.body.grant_types : ["authorization_code"];
    const responseTypesRaw = Array.isArray(req.body?.response_types) ? req.body.response_types : ["code"];

    oauthLog("oauth_register_received", {
      redirectUrisCount: Array.isArray(redirectUrisRaw) ? redirectUrisRaw.length : 0,
      tokenEndpointAuthMethod: tokenEndpointAuthMethodRaw,
      grantTypesCount: Array.isArray(grantTypesRaw) ? grantTypesRaw.length : 0,
      responseTypesCount: Array.isArray(responseTypesRaw) ? responseTypesRaw.length : 0,
    });
    this.logEndpoint("oauth_register_request", req, { status: 0 });

    if (!Array.isArray(redirectUrisRaw) || redirectUrisRaw.length === 0) {
      oauthLog("oauth_register_failed", { reason: "missing_redirect_uris" });
      this.logEndpoint("oauth_register_response", req, { reason: "missing_redirect_uris", status: 400 });
      res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" });
      return;
    }

    const redirectUris = redirectUrisRaw.map((v) => String(v).trim()).filter(Boolean);
    if (redirectUris.length === 0) {
      oauthLog("oauth_register_failed", { reason: "empty_redirect_uris" });
      this.logEndpoint("oauth_register_response", req, { reason: "empty_redirect_uris", status: 400 });
      res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" });
      return;
    }

    if (tokenEndpointAuthMethodRaw !== "none" && tokenEndpointAuthMethodRaw !== "client_secret_post") {
      oauthLog("oauth_register_failed", { reason: "unsupported_token_endpoint_auth_method", tokenEndpointAuthMethod: tokenEndpointAuthMethodRaw });
      this.logEndpoint("oauth_register_response", req, { reason: "unsupported_token_endpoint_auth_method", status: 400 });
      res.status(400).json({ error: "invalid_client_metadata", error_description: "Unsupported token_endpoint_auth_method" });
      return;
    }

    const clientId = `chatgpt_${randomOpaque(18)}`;
    const clientSecret = tokenEndpointAuthMethodRaw === "client_secret_post" ? randomOpaque(24) : undefined;
    const record: RegisteredClientRecord = {
      clientId,
      clientSecret,
      redirectUris,
      tokenEndpointAuthMethod: tokenEndpointAuthMethodRaw,
      grantTypes: grantTypesRaw.map((v: unknown) => String(v)),
      responseTypes: responseTypesRaw.map((v: unknown) => String(v)),
      createdAt: Date.now(),
    };

    this.registeredClients.set(clientId, record);
    this.persistState("oauth_register");
    oauthLog("oauth_register_succeeded", {
      clientId,
      redirectUrisCount: redirectUris.length,
      tokenEndpointAuthMethod: record.tokenEndpointAuthMethod,
    });

    const response: Record<string, unknown> = {
      client_id: clientId,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: record.tokenEndpointAuthMethod,
      grant_types: record.grantTypes,
      response_types: record.responseTypes,
      client_id_issued_at: Math.floor(record.createdAt / 1000),
    };

    if (clientSecret) {
      response.client_secret = clientSecret;
    }

    this.logEndpoint("oauth_register_response", req, { clientId, status: 201 });
    res.status(201).json(response);
  }

  async handleAuthorize(req: Request, res: Response): Promise<void> {
    this.gc();
    const responseType = String(req.query.response_type ?? "");
    const clientId = String(req.query.client_id ?? "");
    const redirectUri = String(req.query.redirect_uri ?? "");
    const state = String(req.query.state ?? "");
    const scopeRaw = String(req.query.scope ?? "mcp");
    const scope = normalizeScope(scopeRaw);
    const resourceRaw = typeof req.query.resource === "string" ? req.query.resource : "";
    const resource = resourceRaw.trim() || undefined;
    const codeChallenge = typeof req.query.code_challenge === "string" ? req.query.code_challenge : "";
    const codeChallengeMethod = typeof req.query.code_challenge_method === "string" ? req.query.code_challenge_method : "";

    oauthLog("oauth_authorize_received", {
      responseType,
      clientId,
      redirectUri,
      hasState: Boolean(state),
      hasCodeChallenge: Boolean(codeChallenge),
      codeChallengeMethod: codeChallengeMethod || "plain",
      scope,
    });
    this.logEndpoint("oauth_authorize_request", req, { clientId, redirectUri, status: 0 });

    if (responseType !== "code" || !clientId || !redirectUri) {
      oauthLog("oauth_authorize_failed", { reason: "invalid_request_missing_required_fields", responseType, clientIdPresent: Boolean(clientId), redirectUriPresent: Boolean(redirectUri) });
      this.logEndpoint("oauth_authorize_response", req, { clientId, redirectUri, reason: "invalid_request_missing_required_fields", status: 400 });
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const isCimdClient = this.isHttpsUrl(clientId);
    if (!this.isClientApproved(clientId) && !isCimdClient) {
      oauthLog("oauth_authorize_unknown_client", { clientId });
      oauthLog("oauth_authorize_failed", { reason: "unauthorized_client_not_approved_or_registered", clientId });
      this.logEndpoint("oauth_authorize_response", req, { clientId, redirectUri, reason: "unauthorized_client_not_approved_or_registered", status: 403 });
      res.status(403).json({ error: "unauthorized_client" });
      return;
    }

    let registeredClient = this.getRegisteredClient(clientId);
    const isExplicitlyApprovedClientId = this.config.approvedClientIds.includes(clientId);
    if (!registeredClient && isCimdClient && !isExplicitlyApprovedClientId) {
      try {
        registeredClient = await this.resolveCimdClient(clientId);
      } catch {
        oauthLog("oauth_authorize_failed", { reason: "invalid_client_cimd_resolution_failed", clientId });
        this.logEndpoint("oauth_authorize_response", req, { clientId, redirectUri, reason: "invalid_client_cimd_resolution_failed", status: 400 });
        res.status(400).json({ error: "invalid_client" });
        return;
      }
    }

    if (registeredClient && !registeredClient.redirectUris.includes(redirectUri)) {
      oauthLog("oauth_authorize_failed", { reason: "redirect_uri_mismatch", clientId, redirectUri });
      this.logEndpoint("oauth_authorize_response", req, { clientId, redirectUri, reason: "redirect_uri_mismatch", status: 400 });
      res.status(400).json({ error: "invalid_request", error_description: "redirect_uri not registered for this client" });
      return;
    }

    const normalizedChallengeMethod = codeChallengeMethod || "plain";
    if (codeChallenge && normalizedChallengeMethod !== "plain" && normalizedChallengeMethod !== "S256") {
      oauthLog("oauth_authorize_failed", { reason: "unsupported_code_challenge_method", codeChallengeMethod: normalizedChallengeMethod });
      this.logEndpoint("oauth_authorize_response", req, { clientId, redirectUri, reason: "unsupported_code_challenge_method", status: 400 });
      res.status(400).json({ error: "invalid_request", error_description: "Unsupported code_challenge_method" });
      return;
    }

    const code = randomOpaque(24);
    this.authCodes.set(code, {
      code,
      clientId,
      redirectUri,
      tokenEndpointAuthMethod: registeredClient?.tokenEndpointAuthMethod,
      codeChallenge: codeChallenge || undefined,
      codeChallengeMethod: codeChallenge ? (normalizedChallengeMethod as "S256" | "plain") : undefined,
      scope,
      resource,
      expiresAt: Date.now() + this.config.authCodeTtlSec * 1000,
      used: false,
    });
    this.persistState("oauth_authorize_issue_code");

    const u = new URL(redirectUri);
    u.searchParams.set("code", code);
    if (state) u.searchParams.set("state", state);
    oauthLog("oauth_authorize_succeeded", {
      clientId,
      redirectUri,
      codeIssued: true,
      codeExpiresAt: this.authCodes.get(code)?.expiresAt ?? null,
      includesState: Boolean(state),
    });
    this.logEndpoint("oauth_authorize_response", req, { clientId, redirectUri, status: 302 });
    res.redirect(302, u.toString());
  }

  handleToken(req: Request, res: Response): void {
    this.gc();
    const grantType = String(req.body?.grant_type ?? "");
    const code = String(req.body?.code ?? "");
    const clientId = String(req.body?.client_id ?? "");
    const redirectUri = String(req.body?.redirect_uri ?? "");
    const clientSecret = String(req.body?.client_secret ?? "");
    const codeVerifier = String(req.body?.code_verifier ?? "");
    const resourceRaw = String(req.body?.resource ?? "");
    const resource = resourceRaw.trim() || undefined;
    const clientAssertionType = String(req.body?.client_assertion_type ?? "");
    const clientAssertion = String(req.body?.client_assertion ?? "");

    oauthLog("oauth_token_received", {
      grantType,
      clientId,
      redirectUri,
      hasCode: Boolean(code),
      hasClientSecret: Boolean(clientSecret),
      hasCodeVerifier: Boolean(codeVerifier),
    });
    this.logEndpoint("oauth_token_request", req, {
      clientId,
      redirectUri,
      grantType,
      hasCodeVerifier: Boolean(codeVerifier),
      status: 0,
    });

    if (grantType !== "authorization_code" || !code || !clientId || !redirectUri) {
      oauthLog("oauth_token_failed", { reason: "invalid_request_missing_required_fields", grantType, clientIdPresent: Boolean(clientId), redirectUriPresent: Boolean(redirectUri), codePresent: Boolean(code) });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "invalid_request_missing_required_fields",
        status: 400,
      });
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const found = this.authCodes.get(code);
    if (!found || found.used || found.expiresAt <= Date.now()) {
      oauthLog("oauth_token_code_not_found", {
        clientId,
        codePresentInStore: Boolean(found),
      });
      oauthLog("oauth_token_failed", {
        reason: "invalid_grant_code_not_found_used_or_expired",
        clientId,
        codePresentInStore: Boolean(found),
        codeUsed: found?.used ?? null,
        codeExpiresAt: found?.expiresAt ?? null,
      });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "invalid_grant_code_not_found_used_or_expired",
        status: 400,
      });
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    if (found.clientId !== clientId || found.redirectUri !== redirectUri) {
      oauthLog("oauth_token_failed", {
        reason: "invalid_grant_client_or_redirect_mismatch",
        expectedClientId: found.clientId,
        receivedClientId: clientId,
        expectedRedirectUri: found.redirectUri,
        receivedRedirectUri: redirectUri,
      });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "invalid_grant_client_or_redirect_mismatch",
        status: 400,
      });
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    if (found.resource && resource && found.resource !== resource) {
      oauthLog("oauth_token_failed", {
        reason: "invalid_grant_resource_mismatch",
        expectedResource: found.resource,
        receivedResource: resource,
      });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "invalid_grant_resource_mismatch",
        status: 400,
      });
      res.status(400).json({ error: "invalid_grant", error_description: "resource mismatch" });
      return;
    }
    const isCimdClient = this.isHttpsUrl(clientId);
    if (!this.isClientApproved(clientId) && !isCimdClient) {
      oauthLog("oauth_token_failed", { reason: "unauthorized_client_not_approved_or_registered", clientId });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "unauthorized_client_not_approved_or_registered",
        status: 403,
      });
      res.status(403).json({ error: "unauthorized_client" });
      return;
    }

    const registeredClient = this.getRegisteredClient(clientId);
    if (registeredClient?.tokenEndpointAuthMethod === "client_secret_post" && (!clientSecret || clientSecret !== registeredClient.clientSecret)) {
      oauthLog("oauth_token_failed", { reason: "invalid_client_secret_mismatch", clientId, tokenEndpointAuthMethod: "client_secret_post" });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "invalid_client_secret_mismatch",
        status: 401,
      });
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    const expectedAuthMethod = found.tokenEndpointAuthMethod || registeredClient?.tokenEndpointAuthMethod || "none";
    if (expectedAuthMethod === "private_key_jwt") {
      const expectedAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
      if (clientAssertionType !== expectedAssertionType || !clientAssertion) {
        oauthLog("oauth_token_failed", { reason: "private_key_jwt_assertion_required", clientId });
        this.logEndpoint("oauth_token_response", req, {
          clientId,
          redirectUri,
          grantType,
          hasCodeVerifier: Boolean(codeVerifier),
          reason: "private_key_jwt_assertion_required",
          status: 401,
        });
        res.status(401).json({ error: "invalid_client", error_description: "private_key_jwt_assertion_required" });
        return;
      }

      oauthLog("oauth_token_failed", { reason: "private_key_jwt_not_implemented", clientId });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "private_key_jwt_not_implemented",
        status: 401,
      });
      res.status(401).json({ error: "invalid_client", error_description: "private_key_jwt_not_implemented" });
      return;
    }
    if (expectedAuthMethod === "none" && clientSecret) {
      oauthLog("oauth_token_failed", { reason: "client_secret_not_allowed_for_public_client", clientId });
      this.logEndpoint("oauth_token_response", req, {
        clientId,
        redirectUri,
        grantType,
        hasCodeVerifier: Boolean(codeVerifier),
        reason: "client_secret_not_allowed_for_public_client",
        status: 400,
      });
      res.status(400).json({ error: "invalid_request", error_description: "client_secret not allowed for this client" });
      return;
    }

    if (found.codeChallenge) {
      if (!codeVerifier) {
        oauthLog("oauth_token_failed", { reason: "missing_code_verifier", clientId });
        this.logEndpoint("oauth_token_response", req, {
          clientId,
          redirectUri,
          grantType,
          hasCodeVerifier: Boolean(codeVerifier),
          reason: "missing_code_verifier",
          status: 400,
        });
        res.status(400).json({ error: "invalid_request", error_description: "code_verifier required" });
        return;
      }
      if (found.codeChallengeMethod === "S256") {
        const hashed = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
        if (hashed !== found.codeChallenge) {
          oauthLog("oauth_token_pkce_mismatch", { clientId, method: "S256" });
          oauthLog("oauth_token_failed", { reason: "pkce_verification_failed_s256", clientId });
          this.logEndpoint("oauth_token_response", req, {
            clientId,
            redirectUri,
            grantType,
            hasCodeVerifier: Boolean(codeVerifier),
            reason: "pkce_verification_failed_s256",
            status: 400,
          });
          res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
          return;
        }
      } else if (codeVerifier !== found.codeChallenge) {
        oauthLog("oauth_token_pkce_mismatch", { clientId, method: "plain" });
        oauthLog("oauth_token_failed", { reason: "pkce_verification_failed_plain", clientId });
        this.logEndpoint("oauth_token_response", req, {
          clientId,
          redirectUri,
          grantType,
          hasCodeVerifier: Boolean(codeVerifier),
          reason: "pkce_verification_failed_plain",
          status: 400,
        });
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }

    found.used = true;
    this.authCodes.set(code, found);

    const token = randomOpaque(32);
    const expiresIn = this.config.accessTokenTtlSec;
    this.accessTokens.set(token, {
      token,
      clientId,
      scope: found.scope || "mcp",
      resource: resource || found.resource,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    this.persistState("oauth_token_exchange");

    res.status(200).json({
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: found.scope || "mcp",
    });
    oauthLog("oauth_token_succeeded", {
      clientId,
      tokenIssued: true,
      expiresIn,
      codeInvalidated: this.authCodes.get(code)?.used === true,
    });
    this.logEndpoint("oauth_token_response", req, {
      clientId,
      redirectUri,
      grantType,
      hasCodeVerifier: Boolean(codeVerifier),
      status: 200,
    });
  }

  validateAccessToken(token: string): boolean {
    this.gc();
    const found = this.accessTokens.get(token);
    if (!found) return false;
    if (found.expiresAt <= Date.now()) {
      this.accessTokens.delete(token);
      this.persistState("oauth_validate_expired_token");
      return false;
    }
    return true;
  }

  handleUserInfo(req: Request, res: Response): void {
    this.gc();
    const authHeader = req.header("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    const found = token ? this.accessTokens.get(token) : undefined;
    const clientId = found?.clientId || null;
    this.logEndpoint("oauth_userinfo_request", req, {
      clientId: clientId || undefined,
      status: 0,
    });
    if (!authHeader?.startsWith("Bearer ")) {
      this.logEndpoint("oauth_userinfo_response", req, { reason: "missing_bearer_token", status: 401 });
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    if (!found || found.expiresAt <= Date.now()) {
      if (found?.expiresAt && found.expiresAt <= Date.now()) {
        this.accessTokens.delete(token);
        this.persistState("oauth_userinfo_expired_token");
      }
      this.logEndpoint("oauth_userinfo_response", req, { reason: "invalid_or_expired_token", status: 401 });
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    this.logEndpoint("oauth_userinfo_response", req, { clientId: found.clientId, status: 200 });
    const scopeSet = new Set((found.scope || "").split(/\s+/).filter(Boolean));
    const email = `${found.clientId}@mcp.alfatek.store`;
    res.status(200).json({
      sub: found.clientId,
      scope: found.scope,
      email: scopeSet.has("email") ? email : undefined,
      email_verified: scopeSet.has("email") ? true : undefined,
      preferred_username: scopeSet.has("profile") ? found.clientId : undefined,
      name: scopeSet.has("profile") ? found.clientId : undefined,
    });
  }
}
