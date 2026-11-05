import path from "node:path";

export function resolveCommandBinary(command: string): string {
  if (process.platform !== "win32") return command;

  const lower = command.toLowerCase();
  if (lower === "npm") return "npm.cmd";
  if (lower === "npx") return "npx.cmd";
  if (lower === "node") return "node.exe";
  if (lower === "git") return "git.exe";
  return command;
}

export function resolveCommandSpec(command: string, args: string[]): { command: string; args: string[] } {
  return {
    command: resolveCommandBinary(command),
    args,
  };
}

export function renderCommandForLog(command: string, args: string[]): string {
  return `${path.basename(command)} ${args.join(" ")}`.trim();
}
