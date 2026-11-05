import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserScreenshotSchema = z.object({
  tabId: z.number().optional(),
  selector: z.string().optional(),
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().optional(),
});

export async function browserScreenshotToolHandler(input: {
  tabId?: number;
  selector?: string;
  format?: string;
  quality?: number;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("screenshot", {
    tabId: input.tabId,
    selector: input.selector,
    format: input.format ?? "png",
    quality: input.quality ?? 80,
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
