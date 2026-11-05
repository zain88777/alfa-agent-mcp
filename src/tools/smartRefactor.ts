import { normalizeInput } from "../core/inputNormalizer.js";

export async function smartRefactorToolHandler(input: {
  code: string;
}) {
  const normalizedInput = normalizeInput(input);
  const code = normalizedInput?.code ?? "";

  if (!code) {
    return {
      content: [
        {
          type: "text" as const,
          text: "No code provided to analyze"
        }
      ]
    };
  }

  const suggestions: string[] = [];

  if (code.includes("any")) {
    suggestions.push("Replace 'any' with strict types");
  }

  if (code.includes("console.log")) {
    suggestions.push("Remove debug logs for production");
  }

  return {
    content: [
      {
        type: "text" as const,
        text: suggestions.join("\n") || "No refactor needed"
      }
    ]
  };
}
