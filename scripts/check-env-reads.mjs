import { spawnSync } from "node:child_process";

const run = spawnSync(process.execPath, ["scripts/report-env-debt.mjs"], { encoding: "utf8" });
if (run.status !== 0) {
  console.error(run.stderr || run.stdout || "env debt report failed");
  process.exit(run.status ?? 1);
}

const parsed = JSON.parse(run.stdout || "{}");
const debt = Array.isArray(parsed.debt) ? parsed.debt : [];

if (debt.length > 0) {
  console.error("Direct process.env reads detected outside approved exceptions:");
  for (const d of debt) {
    console.error(`- ${d.file}:${d.line} envKey=${d.envKey ?? "unknown"} :: ${d.suggestion}`);
  }
  process.exit(1);
}

console.log("Env read guard passed: no unapproved process.env reads.");
process.exit(0);
