import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserConsoleLogsSchema = z.object({
  tabId: z.number().optional(),
  level: z.enum(["all", "error", "warn", "info", "log"]).optional(),
  limit: z.number().optional(),
});

export async function browserConsoleLogsToolHandler(input: {
  tabId?: number;
  level?: string;
  limit?: number;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("console_logs", {
    tabId: input.tabId,
    level: input.level ?? "all",
    limit: input.limit ?? 100,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result.data ?? result, null, 2),
      },
    ],
  };
}
