import { normalizeInput } from "../core/inputNormalizer.js";
import { astPatchNode } from "../ast/astPatchEngine.js";

export async function astPatchNodeToolHandler(input: {
  filePath: string;
  symbolName: string;
  replacementCode: string;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  if (!normalizedInput.symbolName || typeof normalizedInput.symbolName !== "string") {
    throw new Error("Parameter 'symbolName' is required and must be a string");
  }
  if (!normalizedInput.replacementCode || typeof normalizedInput.replacementCode !== "string") {
    throw new Error("Parameter 'replacementCode' is required and must be a string");
  }
  const result = await astPatchNode(normalizedInput as {
    filePath: string;
    symbolName: string;
    replacementCode: string;
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}