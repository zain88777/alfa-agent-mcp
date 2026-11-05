import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserClickSchema = z.object({
  selector: z.string(),
  tabId: z.number().optional(),
});

export async function browserClickToolHandler(input: {
  selector: string;
  tabId?: number;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("element_click", {
    selector: input.selector,
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
