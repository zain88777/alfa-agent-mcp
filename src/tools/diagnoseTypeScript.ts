import { execFile } from "child_process";
import util from "util";
import { resolveCommandSpec } from "../core/commandRunner.js";

const execFileAsync = util.promisify(execFile);
type ExecFailure = Error & { stdout?: string; stderr?: string };

export async function diagnoseTypeScriptToolHandler() {
  try {
    const spec = resolveCommandSpec("npx", ["tsc", "--noEmit", "--pretty", "false"]);
    const { stdout, stderr } = await execFileAsync(spec.command, spec.args, {
      shell: process.platform === "win32",
      maxBuffer: 1024 * 1024 * 10
    });

    return {
      content: [{ type: "text" as const, text: stdout || stderr || "No TypeScript errors." }]
    };
  } catch (error: unknown) {
    const execError = error as ExecFailure;
    const raw = execError.stdout || execError.stderr || execError.message;
    const lines = String(raw).split(/\r?\n/).filter(Boolean);

    const parsed = lines.map((line) => {
      const match = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
      if (!match) return { raw: line };

      return {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4],
        message: match[5]
      };
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }]
    };
  }
}
