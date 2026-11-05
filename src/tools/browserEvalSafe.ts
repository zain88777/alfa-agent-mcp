import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

/**
 * Approved read-only script operations:
 * - DOM read (querySelector, textContent, attributes)
 * - console read (history)
 * - network read (history)
 * - element inspect (getComputedStyle, getBoundingClientRect)
 * 
 * BLOCKED:
 * - password/token/cookie extraction
 * - localStorage/sessionStorage secret access
 * - form submission
 * - navigation
 * - arbitrary code execution
 */

const BLOCKED_PATTERNS = [
  /document\.cookie/i,
  /localStorage/i,
  /sessionStorage/i,
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /\.submit\(\)/i,
  /location\s*=/i,
  /window\.open/i,
  /eval\(/i,
  /new\s+Function/i,
];

export const browserEvalSafeSchema = z.object({
  script: z.string(),
  tabId: z.number().optional(),
});

export async function browserEvalSafeToolHandler(input: {
  script: string;
  tabId?: number;
}) {
  // Security check FIRST: block dangerous patterns before connecting
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(input.script)) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Script blocked by security policy",
              reason: `Pattern "${pattern.source}" is not allowed in browser_eval_safe`,
              allowed: [
                "DOM read (querySelector, textContent, attributes)",
                "Computed styles inspection",
                "Element dimensions/position",
                "Console history read",
                "Network history read",
              ],
            }, null, 2),
          },
        ],
      };
    }
  }

  // Security passed, now check extension connection
  await globalBrowserBridge.ensureExtensionConnected();

  const result = await globalBrowserBridge.send("eval_safe", {
    script: input.script,
    tabId: input.tabId,
  }, 30000);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result.data ?? result, null, 2),
      },
    ],
  };
}
