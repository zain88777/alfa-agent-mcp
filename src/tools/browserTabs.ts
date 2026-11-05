import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserTabsSchema = z.object({});

export async function browserTabsToolHandler() {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("tabs_list");

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result.data ?? result, null, 2),
      },
    ],
  };
}
