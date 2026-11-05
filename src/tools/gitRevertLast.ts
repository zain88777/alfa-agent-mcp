import { execFile } from "child_process";
import util from "util";

const execFileAsync = util.promisify(execFile);

export async function gitRevertLastToolHandler() {
  const { stdout, stderr } = await execFileAsync("git", ["reset", "--hard", "HEAD~1"], {
    shell: false
  });

  return {
    content: [{ type: "text" as const, text: stdout || stderr || "Reverted last checkpoint." }]
  };
}
