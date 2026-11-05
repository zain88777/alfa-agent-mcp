import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserNetworkLogsSchema = z.object({
  tabId: z.number().optional(),
  type: z.enum(["all", "xhr", "fetch", "document", "stylesheet", "script"]).optional(),
  limit: z.number().optional(),
});

export async function browserNetworkLogsToolHandler(input: {
  tabId?: number;
  type?: string;
  limit?: number;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("network_logs", {
    tabId: input.tabId,
    type: input.type ?? "all",
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
