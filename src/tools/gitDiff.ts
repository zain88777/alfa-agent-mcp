import { execFile } from "child_process";
import util from "util";

const execFileAsync = util.promisify(execFile);

export async function gitDiffToolHandler() {
  const { stdout, stderr } = await execFileAsync("git", ["diff"], {
    maxBuffer: 1024 * 1024 * 5
  });

  return {
    content: [{ type: "text" as const, text: stdout || stderr || "No git diff." }]
  };
}