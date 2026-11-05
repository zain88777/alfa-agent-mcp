/**
 * Execution preview tool — aggregates dry-run outputs from mutation tools
 * for a staged plan review. Used by plan_session to collect previews before commit.
 *
 * Each item in the mutations array is passed to the corresponding tool's handler
 * with dryRun=true. Results are aggregated into a unified preview report.
 *
 * This tool does NOT modify the filesystem. It is read-only in terms of mutations.
 * It IS mutating the transaction session state by recording steps.
 */

import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { globalTransactionEngine } from "../core/transactionEngine.js";
import { writeFileToolHandler } from "./writeFile.js";
import { deleteFileToolHandler } from "./deleteFile.js";
import { moveFileToolHandler } from "./moveFile.js";
import { copyFileToolHandler } from "./copyFile.js";
import { applyPatchToolHandler } from "./applyPatch.js";
import { unifiedPatchToolHandler } from "./unifiedPatch.js";

const mutationItemSchema = z.object({
  tool: z.enum(["write_file", "delete_file", "move_file", "copy_file", "apply_patch", "unified_patch"]),
  input: z.record(z.unknown()),
});

export const executionPreviewSchema = z.object({
  sessionId: z.string().describe("Transaction session ID to stage mutations into"),
  mutations: z.array(mutationItemSchema).min(1).describe("List of mutation actions to preview"),
  commit: z.boolean().optional().default(false).describe("Whether to commit after preview (default: false)"),
}).strict();

async function dryRunMutation(tool: string, input: Record<string, unknown>): Promise<string> {
  switch (tool) {
    case "write_file": {
      const result = await writeFileToolHandler(input as Parameters<typeof writeFileToolHandler>[0]);
      return result.content[0].text;
    }
    case "delete_file": {
      const result = await deleteFileToolHandler(input as Parameters<typeof deleteFileToolHandler>[0]);
      return result.content[0].text;
    }
    case "move_file": {
      const result = await moveFileToolHandler(input as Parameters<typeof moveFileToolHandler>[0]);
      return result.content[0].text;
    }
    case "copy_file": {
      const result = await copyFileToolHandler(input as Parameters<typeof copyFileToolHandler>[0]);
      return result.content[0].text;
    }
    case "apply_patch": {
      const result = await applyPatchToolHandler(input as Parameters<typeof applyPatchToolHandler>[0]);
      return result.content[0].text;
    }
    case "unified_patch": {
      const result = await unifiedPatchToolHandler(input as Parameters<typeof unifiedPatchToolHandler>[0]);
      return result.content[0].text;
    }
    default:
      return `[SKIP] Unknown tool: ${tool}`;
  }
}

export async function executionPreviewToolHandler(input: {
  sessionId?: string;
  mutations: Array<{ tool: string; input: Record<string, unknown> }>;
  commit?: boolean;
}) {
  const normalizedInput = normalizeInput(input);

  if (!normalizedInput.sessionId) {
    throw new Error("sessionId is required");
  }

  const session = globalTransactionEngine.getSession(normalizedInput.sessionId);
  if (!session || session.status !== "active") {
    throw new Error(`Session not found or not active: ${normalizedInput.sessionId}`);
  }

  const results: Array<{ tool: string; input: Record<string, unknown>; preview: string; success: boolean; error?: string }> = [];
  let hasFailure = false;

  for (const mutation of normalizedInput.mutations) {
    try {
      const preview = await dryRunMutation(mutation.tool, mutation.input);
      const kind = mutation.tool.replace("_file", "").replace("_patch", "patch") as "write" | "delete" | "move" | "copy" | "patch";
      const paths: string[] = [];

      if (mutation.input.filePath) paths.push(String(mutation.input.filePath));
      if (mutation.input.from) paths.push(String(mutation.input.from));
      if (mutation.input.to) paths.push(String(mutation.input.to));

      globalTransactionEngine.recordStep(
        normalizedInput.sessionId,
        mutation.tool,
        kind,
        paths,
        preview
      );

      results.push({ tool: mutation.tool, input: mutation.input, preview, success: true });
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ tool: mutation.tool, input: mutation.input, preview: "", success: false, error: errorMsg });
      hasFailure = true;
    }
  }

  if (hasFailure) {
    globalTransactionEngine.markFailed(normalizedInput.sessionId, "One or more mutations failed preview");
  }

  const previewResult = globalTransactionEngine.preview(normalizedInput.sessionId);

  const response: Record<string, unknown> = {
    sessionId: normalizedInput.sessionId,
    status: previewResult?.session.status ?? "unknown",
    stepCount: results.length,
    previews: results.map((r, i) => ({
      step: i + 1,
      tool: r.tool,
      success: r.success,
      preview: r.preview,
      error: r.error,
    })),
    sessionStatus: previewResult?.session.status,
    message: hasFailure
      ? `${results.filter(r => r.success).length}/${results.length} mutation(s) previewed successfully. Commit blocked by failures.`
      : `${results.length} mutation(s) staged. Review above and use action='commit' to apply.`,
  };

  if (normalizedInput.commit === true && !hasFailure) {
    const commitResult = await globalTransactionEngine.commit(normalizedInput.sessionId);
    response.committed = true;
    response.commitResults = commitResult?.results;
    response.message = `Preview + commit: ${results.length} mutation(s) applied.`;
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(response, null, 2),
    }],
  };
}