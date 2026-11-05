import { normalizeInput } from "../core/inputNormalizer.js";

export async function decisionEngineToolHandler(input: {
  options: string[];
}) {
  const normalizedInput = normalizeInput(input);
  if (!Array.isArray(normalizedInput.options) || normalizedInput.options.length === 0) {
    throw new Error("Parameter 'options' is required and must be a non-empty array of strings");
  }
  const choice = normalizedInput.options[Math.floor(Math.random() * normalizedInput.options.length)];

  return {
    content: [
      {
        type: "text" as const,
        text: `Selected: ${choice}`
      }
    ]
  };
}
