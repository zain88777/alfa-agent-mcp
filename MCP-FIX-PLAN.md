# MCP Server Fix Plan

## Scope
- Target: `alfa-agent-mcp`
- Goal: harden security, unify runtime behavior, improve reliability, and make codebase maintainable for provider-agnostic desktop agent use.

## Audit Snapshot
- Build: passing (`npm run build` in `alfa-agent-mcp`)
- Lint: failing (86 errors from strict TypeScript/ESLint rules)
- Architecture: works, but has split execution paths and weak guardrails

## Priority P0 (Must Fix First)

### 1. Replace weak path boundary checks in file tools
- Problem:
  - `startsWith(ALLOWED_BASE)` checks are bypass-prone for sibling paths.
  - Affects read/write/delete and similar file tools.
- Evidence:
  - `src/tools/readFile.ts:10`
  - `src/tools/writeFile.ts:10`
  - `src/tools/deleteFile.ts:10`
- Fix:
  - Use centralized `normalizeSafePath(...)` from `src/core/pathSafety.ts`.
  - Enforce `path.relative(base, target)` validation and block absolute/sibling escape.
  - Add shared helper and migrate all file-mutating/reading tools.
- Acceptance criteria:
  - `..` traversal blocked.
  - Sibling base trick (e.g. `C:\workspace2`) blocked.
  - All file tools use one common safety helper.

### 2. Harden command execution
- Problem:
  - `run_command` uses `exec` shell invocation.
- Evidence:
  - `src/tools/runCommand.ts:28`
- Fix:
  - Replace `exec` with `execFile` or `spawn` using static argv mappings.
  - Keep strict allowlist by command id instead of raw command strings.
  - Set explicit cwd to workspace root.
- Acceptance criteria:
  - No shell interpolation path.
  - Only mapped commands execute.
  - Output handling preserved.

### 3. Stop logging full raw tool input by default
- Problem:
  - Raw input is logged and may include secrets.
- Evidence:
  - `src/index.ts:32`
- Fix:
  - Introduce logger redaction (`apiKey`, `token`, `authorization`, `password`, etc.).
  - Gate detailed input logs behind debug env flag.
- Acceptance criteria:
  - Production/default logs are redacted.
  - Debug mode can opt-in to full payload logging.

## Priority P1 (High)

### 4. Add strict per-tool input schemas
- Problem:
  - MCP registration accepts catch-all input.
- Evidence:
  - `src/index.ts:28` uses `z.object({}).catchall(z.any())`
- Fix:
  - Define per-tool zod schemas in tool modules.
  - Register each tool with its schema and description.
  - Remove catch-all default where possible.
- Acceptance criteria:
  - Invalid inputs fail fast with structured error.
  - Tool contracts are discoverable and typed.

### 5. Unify runtime execution path
- Problem:
  - Two parallel execution models exist (registry-based and direct map-based).
- Evidence:
  - `src/engine/executePlan.ts` (registry path)
  - `src/engine/agentLoop.ts` + `src/engine/toolExecutor.ts` (direct map)
- Fix:
  - Standardize all agent execution via `ToolRegistry.execute(...)`.
  - Deprecate direct `ToolExecutor` function-map path.
- Acceptance criteria:
  - Single execution path for all agent flows.
  - Logging/timeout/error behavior consistent.

### 6. Real approval and policy enforcement
- Problem:
  - Approval queue is minimal in-memory only; policy is weak substring check.
- Evidence:
  - `src/core/approvalEngine.ts`
  - `src/core/policyEngine.ts`
- Fix:
  - Add structured approval records with action type, scope, expiry.
  - Add policy tiers: read-only, safe-write, dangerous.
  - Add deny-by-default for destructive operations unless approved.
- Acceptance criteria:
  - Dangerous actions always require explicit approval.
  - Session/workspace scoped approvals supported.

## Priority P2 (Quality + Maintainability)

### 7. Eliminate lint debt (86 errors)
- Problem:
  - Strict lint gate fails heavily (`any`, empty blocks, ban-types, unused vars).
- Fix:
  - Phase A: core and engine typing cleanup.
  - Phase B: tools typing cleanup + explicit interfaces.
  - Replace empty catch blocks with intentional handling/log note.
- Acceptance criteria:
  - `npm run lint` passes at workspace root.
  - `any` usage only where explicitly justified.

### 8. Normalize error response shape
- Problem:
  - Mixed throw styles and inconsistent result payload patterns.
- Fix:
  - Standardize tool error envelope (`code`, `message`, `details`).
  - Convert registry/tool throws to consistent user-facing format.
- Acceptance criteria:
  - Client can render deterministic error UI.

### 9. Add automated tests for safety-critical paths
- Focus areas:
  - Path traversal tests
  - Command policy/allowlist tests
  - Input schema validation tests
  - Approval gating tests
- Acceptance criteria:
  - Unit tests for all P0/P1 fixes.
  - CI gate for test + lint + build.

## Priority P3 (Product Readiness)

### 10. Provider abstraction upgrade
- Current state:
  - LLM client is OpenAI-compatible and env-driven (`src/llm/llmClient.ts`).
- Fix:
  - Add provider gateway interface (`chat`, `stream`, `models`, `validateConfig`).
  - Implement adapters: OpenAI-compatible, Anthropic, Gemini, Ollama.
- Acceptance criteria:
  - Model/provider switch without changing agent core.

### 11. Improve observability
- Fix:
  - Add structured metrics: tool latency, timeout counts, policy blocks.
  - Add correlation IDs across plan -> tool -> result chain.
- Acceptance criteria:
  - Debugging production incidents is traceable end-to-end.

## Suggested Execution Order (Sprint-Friendly)
1. P0.1 path safety refactor
2. P0.2 command hardening
3. P0.3 logging redaction
4. P1.4 input schemas
5. P1.5 runtime unification
6. P1.6 approval/policy engine
7. P2.7 lint cleanup
8. P2.8 error normalization
9. P2.9 tests + CI gates
10. P3 provider gateway + observability

## Verification Checklist
- [ ] `npm run build` passes (`alfa-agent-mcp`)
- [ ] `npm run lint` passes (workspace root)
- [ ] Safety test suite passes
- [ ] Dangerous actions blocked unless approved
- [ ] No secret-like fields in default logs
- [ ] Single runtime path active

## Reference Files
- `src/index.ts`
- `src/core/toolRegistry.ts`
- `src/core/pathSafety.ts`
- `src/core/approvalEngine.ts`
- `src/core/policyEngine.ts`
- `src/core/inputNormalizer.ts`
- `src/engine/agentLoop.ts`
- `src/engine/executePlan.ts`
- `src/engine/toolExecutor.ts`
- `src/tools/runCommand.ts`
- `src/tools/readFile.ts`
- `src/tools/writeFile.ts`
- `src/tools/deleteFile.ts`
- `src/llm/llmClient.ts`
