import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserTypeSchema = z.object({
  selector: z.string(),
  text: z.string(),
  tabId: z.number().optional(),
  clear: z.boolean().optional(),
});

export async function browserTypeToolHandler(input: {
  selector: string;
  text: string;
  tabId?: number;
  clear?: boolean;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("element_type", {
    selector: input.selector,
    text: input.text,
    tabId: input.tabId,
    clear: input.clear ?? false,
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
