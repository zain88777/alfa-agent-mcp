import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { normalizeInput } from "../core/inputNormalizer.js";

const LOG_DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const LOG_FILE = path.join(LOG_DIR, "agent.log");

export async function appendLogToolHandler(input: { message: string }) {
  // Diagnostic logging to see actual input structure
  const inputStr = JSON.stringify(input);
  const inputType = typeof input;
  const isObject = input !== null && typeof input === "object";
  const hasInput = isObject && "input" in input;
  const hasMessage = isObject && "message" in input;
  
  console.error("[appendLog] DEBUG - received input:", {
    type: inputType,
    isObject,
    hasInput,
    hasMessage,
    keys: isObject ? Object.keys(input) : "N/A",
    stringified: inputStr.substring(0, 200)
  });

  const normalizedInput = normalizeInput(input);
  
  console.error("[appendLog] DEBUG - after normalizeInput:", {
    type: typeof normalizedInput,
    keys: Object.keys(normalizedInput),
    message: normalizedInput?.message,
    messageType: typeof normalizedInput?.message
  });

  if (!normalizedInput.message || typeof normalizedInput.message !== "string") {
    throw new Error(
      `Parameter 'message' is required and must be a string. ` +
      `Got: normalizedInput.message = ${JSON.stringify(normalizedInput.message)} ` +
      `(type: ${typeof normalizedInput.message}), full input was: ${inputStr}`
    );
  }
  const line = `[${new Date().toISOString()}] ${normalizedInput.message.trim()}\n`;

  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.appendFile(LOG_FILE, line, "utf-8");

  return {
    content: [
      {
        type: "text" as const,
        text: "Log appended successfully."
      }
    ]
  };
}

