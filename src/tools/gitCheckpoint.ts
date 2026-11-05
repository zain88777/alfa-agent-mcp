import { execFile } from "child_process";
import util from "util";

const execFileAsync = util.promisify(execFile);
type ExecFailure = Error & { stdout?: string; stderr?: string };

export async function gitCheckpointToolHandler(input: { message: string }) {
  await execFileAsync("git", ["add", "."], { shell: false });

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["commit", "-m", input.message || "Alfa Agent checkpoint"],
      { shell: false }
    );

    return {
      content: [{ type: "text" as const, text: stdout || stderr || "Checkpoint created." }]
    };
  } catch (error: unknown) {
    const execError = error as ExecFailure;
    return {
      content: [{ type: "text" as const, text: execError.stdout || execError.stderr || execError.message }]
    };
  }
}
