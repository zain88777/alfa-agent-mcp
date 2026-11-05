# alfa-agent-mcp

A local, provider-agnostic MCP (Model Context Protocol) server that gives coding agents a broad, policy-governed tool surface for working with a codebase: files, search, git, the terminal, AST analysis, browser automation, a screen agent, memory, planning, and audit trails.

The same tool registry is exposed over **stdio** and **streamable HTTP**, with bearer-token or OAuth 2.0 protection on the HTTP transport.

## Highlights

- **122 registered tools**, every one classified into a policy tier — zero unclassified.
- **Deny-by-default policy engine.** Unknown tools are refused outright; `dangerous` and `system_sensitive` tools require an explicit, expiring approval.
- **Lineage-scoped, expiry-bound approvals** with a queue and inheritance rules.
- **Centralized path safety** (`src/core/pathSafety.ts`) — workspace escapes and `..` traversal are blocked for every file tool.
- **Hardened command execution** — commands run through a static argv allowlist, never a shell string.
- **Secret redaction** across logs, error envelopes, snapshots, checkpoints, and audit exports.
- **Hash-chained audit trail** with export, verification, and deterministic replay.
- **Checksummed runtime checkpoints** — export and re-import approvals, cache, and quota state.
- **Observability** — trace propagation (`requestId`, `parentRequestId`, `traceId`, `spanId`) plus tool and provider metrics.
- **Provider abstraction** — `openai`, `openai_compatible`, `anthropic`, `gemini`, `ollama`.
- **Browser and screen agents** — a DevTools bridge over WebSocket and an approval-gated screen control surface.
- **CI-gated env hygiene** — the build fails if any file outside the allowlist reads `process.env` directly.

## Requirements

- Node.js `>=20.19.0 <21` (pinned to `20.19.0` in `.nvmrc`)
- npm `>=10.8.0 <12`

## Install

```bash
npm ci
npm run build
```

## Configuration

Configuration is read once by the centralized loader in `src/core/runtimeConfig.ts` and validated against a zod schema. Invalid configuration fails fast with a `CONFIG_INVALID` error rather than silently falling back to unsafe defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALFA_WORKSPACE_ROOT` | `process.cwd()` | Directory that file and command tools are confined to |
| `ALFA_DEBUG` | `false` | Enables full, unredacted tool input logging — never enable in production |
| `ALFA_TOOL_TIMEOUT_MS` | – | Per-tool execution timeout |
| `ALFA_APPROVAL_EXPIRY_MS` | – | Approval lifetime |
| `ALFA_MAX_PLAN_STEPS` / `ALFA_MAX_PLAN_DEPTH` | – | Planner bounds |
| `ALFA_MAX_CONSECUTIVE_FAILURES` | – | Agent loop circuit breaker |
| `ALFA_OBSERVABILITY_RECENT_TRACE_LIMIT` | – | Trace ring-buffer size |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_TIMEOUT_MS` | – | Provider selection and credentials |
| `MCP_API_TOKEN` | – | Static bearer token for the HTTP transport |
| `MCP_DISABLE_AUTH` | `false` | Disables HTTP auth — local development only |
| `MCP_ALLOW_DANGEROUS_TOOLS` | `false` | Auto-allows `dangerous` tier tools without an approval |
| `MCP_OAUTH_ISSUER` / `MCP_OAUTH_APPROVED_CLIENT_IDS` / `MCP_OAUTH_ACCESS_TOKEN_TTL_SEC` / `MCP_OAUTH_AUTH_CODE_TTL_SEC` / `MCP_OAUTH_STATE_PATH` | – | OAuth 2.0 authorization server settings |
| `BRIDGE_PORT` | `9223` | WebSocket port for the browser DevTools bridge |
| `ENABLE_SCREEN_AGENT` | `false` | Enables the screen agent |
| `SCREEN_AGENT_BRIDGE_URL` / `SCREEN_AGENT_BRIDGE_TOKEN` | – | Screen bridge connection |
| `SCREEN_AGENT_APPROVAL_TIMEOUT_MS` | `120000` | Screen action approval window |
| `SCREEN_AGENT_ACTION_RATE_LIMIT_PER_MIN` | `60` | Screen action rate limit |
| `SCREEN_AGENT_OBSERVE_MAX_DIMENSION` / `SCREEN_AGENT_OBSERVE_JPEG_QUALITY` | `1280` / `70` | Screen capture constraints |

A `.env` file in the working directory is loaded automatically at startup. See `.env.example` for a template.

## Running

```bash
npm run dev     # tsx src/index.ts
npm start       # node dist/index.js
```

With no arguments the server starts in **stdio** mode and also serves **streamable HTTP** on `http://localhost:3000/mcp`.

### Connecting a client

```json
{
  "mcpServers": {
    "alfa-dev-os": {
      "url": "http://localhost:3000/mcp",
      "transport": "streamableHttp"
    }
  }
}
```

The HTTP transport accepts either the configured `MCP_API_TOKEN` as a bearer token or an OAuth access token. `initialize` and `tools/list` are permitted without auth for session bootstrap; every other method requires a token.

## CLI

```bash
node dist/cli.js health               # runtime health snapshot
node dist/cli.js tools:list           # tool metadata (no handlers)
node dist/cli.js config:check         # validate and print redacted config
node dist/cli.js runtime:snapshot     # redacted runtime state snapshot
node dist/cli.js checkpoint:export [path]
node dist/cli.js checkpoint:import [path]
node dist/cli.js audit:export [path]
node dist/cli.js audit:verify [path]
node dist/cli.js replay:simulate [path]
node dist/cli.js env:guard            # env-read policy guard
node dist/cli.js release-check        # lint + typecheck + test + build + env:guard
```

## Policy tiers

Every tool is classified into exactly one tier:

| Tier | Default | Approval |
| --- | --- | --- |
| `read_only` | allowed | not required |
| `safe_write` | allowed | not required |
| `dangerous` | denied | required |
| `system_sensitive` | denied | required |

Approvals are lineage-scoped and expiry-bound: an approval covers the requested action and its descendants, and only until `ALFA_APPROVAL_EXPIRY_MS` elapses. `tools:list` reports each tool's tier and approval requirement so a client can render the policy surface without probing.

## Tool surface

122 tools across a dozen categories:

- **Files** — read, write, search, copy, move, delete, replace, patch, backups, stats, project tree
- **Code intelligence** — AST symbol index, import graph, impact analysis, dependency scan, duplicate files, code quality scoring, typecheck, dead-code and route scanning
- **Git** — status, diff, checkpoint, revert
- **Execution** — `run_command`, `powershell_run`, `npm_test`, task runner, parallel run
- **Browser** — tabs, navigation, click, type, screenshot, DOM snapshot, console and network logs
- **Screen agent** — start/stop, observe, click, type, key, scroll, move, wait
- **Agents and planning** — plan session/execute, agent run/loop/execute, sub-agent router, multi-agent run, orchestrator, goal workflow
- **Memory and state** — agent memory, checklist, recent files, todo scan, session coordination
- **Observability and audit** — metrics snapshot, audit export/verify, replay, runtime recovery, self-audit, self-improve
- **Security** — env scan, security scan, protected paths

## Testing

```bash
npm run test        # node --test over test/**/*.test.ts
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src test
npm run env:guard   # fails if non-allowlisted files read process.env
npm run release:check
```

The suite covers path traversal, command allowlisting, input schema validation, approval gating, policy classification, checkpoint export/import, audit hash-chain verification, and CLI/HTTP lifecycle behavior. `.github/workflows/release-check.yml` runs the same gates in CI.

## Project layout

```
src/
  index.ts            # MCP server entry (stdio + HTTP), tool registration, auth
  cli.ts              # operator CLI
  core/               # registry, policy, approvals, config, persistence, audit, safety
  tools/              # individual tool implementations
  engine/             # agent loop, plan execution, tool executor
  llm/                # provider abstraction and clients
  agents/             # sub-agent runtime
  ast/                # AST parsing and analysis
test/                 # node:test suites, including smoke and lifecycle checks
scripts/              # CI guards and release evidence tooling
```

## Security notes

- File and command tools are confined to `ALFA_WORKSPACE_ROOT`; sibling-directory and `..` escapes are rejected.
- Command execution uses a static argv mapping — no shell interpolation.
- Logs, error envelopes, snapshots, checkpoints, and audit exports redact sensitive fields. Debug mode opts back into full payload logging and should never be enabled against an untrusted network.
- The HTTP transport is protected by bearer tokens or OAuth; `MCP_DISABLE_AUTH` exists only for local development.
- Direct `process.env` access is restricted to `src/core/runtimeConfig.ts` and enforced in CI by `scripts/check-env-reads.mjs`.

## License

ISC
