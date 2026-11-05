import { LLMClient } from "../llm/llmClient.js";
import fs from "fs/promises";

export async function codeRewriteToolHandler(input: {
  filePath?: string;
  instruction?: string;
}) {
  if (!input.filePath || typeof input.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  if (!input.instruction || typeof input.instruction !== "string") {
    throw new Error("Parameter 'instruction' is required and must be a string");
  }

  const llm = new LLMClient();

  const original = await fs.readFile(input.filePath, "utf-8");

  const prompt = `
You are a senior TypeScript engineer.

Rewrite the following code based on instruction.

Instruction:
${input.instruction}

Code:
${original}

Return ONLY updated code.
`;

  const res = await llm.generate({ prompt });

  await fs.writeFile(input.filePath, res.text, "utf-8");

  return {
    content: [
      {
        type: "text" as const,
        text: "Code rewritten successfully"
      }
    ]
  };
}