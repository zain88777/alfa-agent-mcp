import { execFile } from "child_process";
import util from "util";
import fs from "fs/promises";
import { resolveCommandSpec } from "../core/commandRunner.js";

const execFileAsync = util.promisify(execFile);
type ExecFailure = Error & { stdout?: string; stderr?: string };

export async function npmTestToolHandler() {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf-8"));

  if (!pkg.scripts?.test) {
    return { content: [{ type: "text" as const, text: "No test script found in package.json." }] };
  }

  try {
    const spec = resolveCommandSpec("npm", ["test"]);
    const { stdout, stderr } = await execFileAsync(spec.command, spec.args, {
      shell: process.platform === "win32",
      maxBuffer: 1024 * 1024 * 10
    });

    return {
      content: [{ type: "text" as const, text: stdout || stderr || "Tests passed." }]
    };
  } catch (error: unknown) {
    const execError = error as ExecFailure;
    return {
      content: [{ type: "text" as const, text: execError.stdout || execError.stderr || execError.message }]
    };
  }
}
