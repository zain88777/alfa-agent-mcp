import fs from "fs/promises";

export async function readAgentInstructionsToolHandler() {
  const candidates = ["AGENTS.md", ".agents.md", "CLAUDE.md", "README.md"];
  const found: Record<string, string> = {};

  for (const file of candidates) {
    try {
      found[file] = await fs.readFile(file, "utf-8");
    } catch {}
  }

  return {
    content: [
      {
        type: "text" as const,
        text: Object.keys(found).length ? JSON.stringify(found, null, 2) : "No agent instruction file found."
      }
    ]
  };
}
