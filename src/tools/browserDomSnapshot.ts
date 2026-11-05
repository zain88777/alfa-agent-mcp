import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserDomSnapshotSchema = z.object({
  tabId: z.number().optional(),
  selector: z.string().optional(),
  depth: z.number().optional(),
});

export async function browserDomSnapshotToolHandler(input: {
  tabId?: number;
  selector?: string;
  depth?: number;
}) {
  await globalBrowserBridge.ensureExtensionConnected();
  const result = await globalBrowserBridge.send("dom_snapshot", {
    tabId: input.tabId,
    selector: input.selector,
    depth: input.depth,
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
