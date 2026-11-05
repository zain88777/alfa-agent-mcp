import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserScrollSchema = z.object({
  tabId: z.number().optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  pixels: z.number().optional(),
  selector: z.string().optional(),
});

export async function browserScrollToolHandler(input: {
  tabId?: number;
  direction?: string;
  pixels?: number;
  selector?: string;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("element_scroll", {
    tabId: input.tabId,
    direction: input.direction ?? "down",
    pixels: input.pixels ?? 300,
    selector: input.selector,
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
