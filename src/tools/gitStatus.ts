import { exec } from "child_process";
import util from "util";

const execAsync = util.promisify(exec);

export async function gitStatusToolHandler() {
  const { stdout, stderr } = await execAsync("git status --short");

  return {
    content: [
      {
        type: "text" as const,
        text: stdout || stderr || "Working tree clean."
      }
    ]
  };
}