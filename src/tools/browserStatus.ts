import { z } from "zod";
import { globalBrowserBridge } from "../core/browserBridge.js";

export const browserStatusSchema = z.object({});

export async function browserStatusToolHandler() {
  const bridge = globalBrowserBridge;
  
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          bridgeConnected: bridge.isConnected,
          extensionConnected: bridge.isExtensionConnected,
          host: "127.0.0.1",
          port: 9223,
        }, null, 2),
      },
    ],
  };
}
