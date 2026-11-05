import { initSystem } from "../core/initSystem.js";
import { runParallel } from "../engine/parallelAgents.js";

export async function parallelRunToolHandler() {
  const { registry } = initSystem();

  const tasks = [
    () => registry.execute("project_summary", {}),
    () => registry.execute("search_files", { query: "error" })
  ];

  const result = await runParallel(tasks);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}
