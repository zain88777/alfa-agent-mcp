import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserObserveSchema = z.object({
  tabId: z.number().optional(),
});

export async function browserObserveToolHandler(input: { tabId?: number }) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("tab_observe", { tabId: input.tabId });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result.data ?? result, null, 2),
      },
    ],
  };
}
