import { execFile } from "child_process";
import util from "util";

const execAsync = util.promisify(execFile);

export async function autoCommitToolHandler() {
  await execAsync("git", ["add", "."], { shell: false });

  const { stdout } = await execAsync(
    "git",
    ["commit", "-m", "auto: AI commit"],
    { shell: false }
  );

  return {
    content: [{ type: "text" as const, text: stdout || "Committed" }]
  };
}
