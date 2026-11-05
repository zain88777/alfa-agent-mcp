import { execFile } from "child_process";
import util from "util";
import { resolveCommandSpec } from "../core/commandRunner.js";

const execFileAsync = util.promisify(execFile);
type ExecFailure = Error & { stdout?: string; stderr?: string };

export async function typecheckToolHandler() {
  try {
    const spec = resolveCommandSpec("npx", ["tsc", "--noEmit"]);
    const { stdout, stderr } = await execFileAsync(spec.command, spec.args, {
      maxBuffer: 1024 * 1024 * 5,
      shell: process.platform === "win32"
    });

    return {
      content: [{ type: "text" as const, text: stdout || stderr || "Typecheck passed." }]
    };
  } catch (error: unknown) {
    const execError = error as ExecFailure;
    return {
      content: [{ type: "text" as const, text: execError.stdout || execError.stderr || execError.message }]
    };
  }
}
