import { execFile } from "child_process";
import util from "util";

const execAsync = util.promisify(execFile);

export async function checkpoint() {
  await execAsync("git", ["add", "."], { shell: false });

  await execAsync("git", ["commit", "-m", "checkpoint"], {
    shell: false
  });
}
