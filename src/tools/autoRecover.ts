import { execFile } from "child_process";
import util from "util";

const execAsync = util.promisify(execFile);

export async function autoRecoverToolHandler() {
  const { stdout } = await execAsync("git", ["reset", "--hard"], { shell: false });

  return {
    content: [{ type: "text" as const, text: stdout || "Recovered to clean state" }]
  };
}
