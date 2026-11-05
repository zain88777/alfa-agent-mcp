import { execFile } from "child_process";
import util from "util";

const execFileAsync = util.promisify(execFile);

export async function diffReviewToolHandler() {
  const { stdout } = await execFileAsync("git", ["diff", "--stat"], { shell: false });

  const { stdout: names } = await execFileAsync("git", ["diff", "--name-only"], {
    shell: false
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            changedFiles: names.split(/\r?\n/).filter(Boolean),
            stats: stdout || "No diff."
          },
          null,
          2
        )
      }
    ]
  };
}
