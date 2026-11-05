# Release Readiness Checklist (P3.18)

## Scope
- Audit-only pass.
- No runtime behavior changes, no feature additions.

## Supported Toolchain
- Node.js: `20.19.0` (pinned via `.nvmrc`)
- Supported Node range: `>=20.19.0 <21` (`package.json#engines`)
- Supported npm range: `>=10.8.0 <12` (`package.json#engines`)

## Required Commands
0. `npm ci`
1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`
5. `npm run env:guard`
6. `npm run release:check`

## Expected Results
- Lint: `0 errors`, `0 warnings`.
- Typecheck: pass (`tsc --noEmit`).
- Tests: pass (`190/190`).
- Build: pass (`tsc` emits dist).
- Env guard: pass (`no unapproved process.env reads`).
- Release check: pass (all gates above pass in sequence).
- Install reproducibility: `npm ci` succeeds using committed lockfile (`package-lock.json`).

## Security Posture
- Policy engine is deny-by-default for unknown/unclassified tools.
- Default runtime tool policy classification complete (`unclassifiedTools = 0`).
- Dangerous and system-sensitive tools require approval.
- Approval inheritance is lineage-scoped and expiry-bound.
- Raw handler bypass prevented (no public `registry.get()` execution path).
- Error normalization removes stack/path/secret leakage.
- Command/path safety controls and regression tests are in place.
- Env-read CI guard blocks unapproved direct `process.env` usage.

## Runtime Health
- Health snapshot target state:
  - `status: healthy`
  - `unclassifiedTools: 0`
- Observability snapshot includes execution and provider metrics.

## Provider Abstraction
- OpenAI-compatible default preserved.
- Adapter factory supports: `openai`, `openai_compatible`, `anthropic`, `gemini`, `ollama`.
- Provider errors normalize into stable error envelope codes.
- Provider config redaction prevents secret leakage.

## Observability and Correlation
- Trace propagation includes `requestId`, `parentRequestId`, `traceId`, `spanId`.
- Tool/provider metrics tracked and exposed in stable snapshot shape.
- Structured logs redact sensitive values.

## Config and Environment Safety
- Centralized runtime config loader validates schema.
- Invalid config fails safely with `CONFIG_INVALID`.
- Safe defaults applied for timeouts, limits, approval expiry, debug mode, observability limits.

## Policy Coverage Snapshot
- `read_only`: 38
- `safe_write`: 10
- `dangerous`: 33
- `system_sensitive`: 7
- `total`: 88

## Go / No-Go Criteria
- Go when ALL are true:
  - `npm run release:check` passes.
  - Runtime health snapshot remains healthy with zero unclassified tools.
  - No secret leakage regressions in tests/logs/errors/snapshots.
  - Env guard remains green.
- No-Go if ANY are true:
  - Any gate in `release:check` fails.
  - Health snapshot becomes degraded/unhealthy due to policy classification or execution safety regressions.
  - Secret leakage appears in logs/errors/snapshots.

## Known Limitations
- Non-blocking local npm environment warning may appear:
  - `Unknown env config "msvs-version"`
  - This is external tooling/environment debt, not runtime code debt.

## Remaining Risks
- Main residual risk is operational/config drift in deployment environment (Node/npm/toolchain mismatch).
- Mitigation: run `release:check` in CI and on release candidate commit; pin Node/npm versions in CI.

## Recommended Pre-Release Procedure
1. Run `npm run release:check` on clean branch/commit.
2. Confirm runtime health snapshot is healthy and classification count unchanged.
3. Archive test/build logs as release evidence.
4. Tag release candidate and repeat checks in CI environment.

## CI and Artifact Evidence
- CI workflow: `.github/workflows/release-check.yml`
- CI behavior:
  - installs dependencies via `npm ci`
  - runs release gates (`lint`, `typecheck`, `test`, `build`, `env:guard`)
  - writes command logs into `artifacts/logs/`
  - generates `artifacts/release-evidence.md`
  - uploads artifacts via `actions/upload-artifact`

## Release Evidence Template
- Commit: `<GITHUB_SHA or local commit hash>`
- Timestamp (UTC): `<YYYY-MM-DDTHH:MM:SSZ>`
- Node/npm versions: `<node -v> / <npm -v>`
- Command run: `npm run release:check`
- Result: `PASS|FAIL`
- Test count: `<passed>/<total>`
- Build result: `PASS|FAIL`
