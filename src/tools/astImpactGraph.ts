import { normalizeInput } from "../core/inputNormalizer.js";
import { buildImpactGraph } from "../ast/impactGraph.js";

export async function astImpactGraphToolHandler(input: {
  file: string;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.file || typeof normalizedInput.file !== "string") {
    throw new Error("Parameter 'file' is required and must be a string");
  }
  const graph = await buildImpactGraph(normalizedInput.file);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(graph, null, 2)
      }
    ]
  };
}