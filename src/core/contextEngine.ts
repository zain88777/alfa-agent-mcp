import fs from "fs/promises";

export async function loadContext() {
  let agents = "";

  try {
    agents = await fs.readFile("AGENTS.md", "utf-8");
  } catch {}

  return {
    instructions: agents
  };
}
