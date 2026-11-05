import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserInspectElementSchema = z.object({
  selector: z.string(),
  tabId: z.number().optional(),
});

export async function browserInspectElementToolHandler(input: {
  selector: string;
  tabId?: number;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("inspect_element", {
    selector: input.selector,
    tabId: input.tabId,
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
