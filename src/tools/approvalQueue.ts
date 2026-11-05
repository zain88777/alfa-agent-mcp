import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { ApprovalEngine } from "../core/approvalEngine.js";

const DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const FILE = path.join(DIR, "approval-queue.json");

export async function approvalQueueToolHandler(input: {
  action: "add" | "list" | "clear";
  title?: string;
  command?: string;
  reason?: string;
}, approvalEngine?: ApprovalEngine) {
  await fs.mkdir(DIR, { recursive: true });

  let queue: unknown[] = [];

  try {
    queue = JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {}

  if (input.action === "clear") {
    if (approvalEngine) {
      approvalEngine.clear();
    }
    queue = [];
  }

  if (input.action === "add") {
    queue.push({
      title: input.title ?? "Approval required",
      command: input.command ?? "",
      reason: input.reason ?? "",
      createdAt: new Date().toISOString()
    });
  }

  if (input.action === "list" && approvalEngine) {
    const pending = approvalEngine.listPending().map((a) => ({
      approvalId: a.id,
      requestId: a.requestId,
      toolName: a.toolName,
      tier: a.policyTier,
      reason: a.reason ?? "Approval required for policy tier",
      status: a.status,
      createdAt: new Date(a.createdAt).toISOString(),
      expiresAt: new Date(a.expiresAt).toISOString(),
      sessionId: a.sessionId ?? null,
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(pending, null, 2) }]
    };
  }

  await fs.writeFile(FILE, JSON.stringify(queue, null, 2), "utf-8");

  return {
    content: [{ type: "text" as const, text: JSON.stringify(queue, null, 2) }]
  };
}


