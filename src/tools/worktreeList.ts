import { execFile } from "child_process";
import util from "util";

const execFileAsync = util.promisify(execFile);
type ExecFailure = Error & { stdout?: string; stderr?: string };

export async function worktreeListToolHandler() {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["worktree", "list"], {
      shell: false
    });

    return {
      content: [{ type: "text" as const, text: stdout || stderr || "No worktrees found." }]
    };
  } catch (error: unknown) {
    const execError = error as ExecFailure;
    return {
      content: [{ type: "text" as const, text: execError.stdout || execError.stderr || execError.message }]
    };
  }
}
