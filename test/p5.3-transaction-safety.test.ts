import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { TransactionEngine } from "../src/core/transactionEngine.js";
import { planSessionToolHandler } from "../src/tools/planSession.js";
import { executionPreviewToolHandler } from "../src/tools/executionPreview.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";

function createWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setWorkspace(root: string) {
  process.env.ALFA_WORKSPACE_ROOT = root;
}

describe("P5.3 TransactionEngine", () => {
  let engine: TransactionEngine;
  let base: string;

  beforeEach(() => {
    engine = new TransactionEngine();
    base = createWorkspace("p53-tx-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  describe("session lifecycle", () => {
    it("creates session with active status", () => {
      const session = engine.createSession("test-session");
      assert.ok(session.id);
      assert.equal(session.status, "active");
      assert.equal(session.name, "test-session");
      assert.ok(Array.isArray(session.steps));
      assert.equal(session.steps.length, 0);
    });

    it("creates unnamed session", () => {
      const session = engine.createSession();
      assert.ok(session.id);
      assert.equal(session.status, "active");
    });

    it("gets existing session", () => {
      const created = engine.createSession();
      const retrieved = engine.getSession(created.id);
      assert.ok(retrieved);
      assert.equal(retrieved?.id, created.id);
    });

    it("returns undefined for unknown session", () => {
      const retrieved = engine.getSession("not-found");
      assert.equal(retrieved, undefined);
    });
  });

  describe("recordStep", () => {
    it("records steps to active session", () => {
      const session = engine.createSession();
      const step = engine.recordStep(session.id, "write_file", "write", ["test.txt"], "[DRY-RUN] Would write test.txt");
      assert.ok(step);
      assert.equal(step?.toolName, "write_file");
      assert.equal(step?.kind, "write");
      assert.deepEqual(step?.paths, ["test.txt"]);
    });

    it("does not record to unknown session", () => {
      const step = engine.recordStep("not-found", "write_file", "write", ["test.txt"], "preview");
      assert.equal(step, null);
    });

    it("does not record to non-active session", () => {
      const session = engine.createSession();
      engine.preview(session.id);
      const step = engine.recordStep(session.id, "write_file", "write", ["test.txt"], "preview");
      assert.equal(step, null);
    });
  });

  describe("preview", () => {
    it("returns session with previews", () => {
      const session = engine.createSession();
      engine.recordStep(session.id, "write_file", "write", ["a.txt"], "Would write a.txt");
      engine.recordStep(session.id, "delete_file", "delete", ["b.txt"], "Would delete b.txt");
      const result = engine.preview(session.id);
      assert.ok(result);
      assert.equal(result.session.status, "preview");
      assert.equal(result.previews.length, 2);
      assert.ok(result.summary.includes("2 step(s)"));
    });

    it("returns null for unknown session", () => {
      const result = engine.preview("not-found");
      assert.equal(result, null);
    });
  });

  describe("commit", () => {
    it("commits active session", async () => {
      const session = engine.createSession();
      engine.recordStep(session.id, "write_file", "write", ["a.txt"], "Would write");
      const result = await engine.commit(session.id);
      assert.ok(result);
      assert.equal(result.session.status, "committed");
      assert.ok(result.session.committedAt);
    });

    it("commits preview session", async () => {
      const session = engine.createSession();
      engine.recordStep(session.id, "write_file", "write", ["a.txt"], "Would write");
      engine.preview(session.id);
      const result = await engine.commit(session.id);
      assert.ok(result);
      assert.equal(result.session.status, "committed");
    });

    it("returns null for unknown session", async () => {
      const result = await engine.commit("not-found");
      assert.equal(result, null);
    });
  });

  describe("rollback", () => {
    it("marks session as rolled_back", async () => {
      const session = engine.createSession();
      const result = await engine.rollback(session.id);
      assert.ok(result);
      assert.equal(result.session.status, "rolled_back");
    });

    it("returns null for unknown session", async () => {
      const result = await engine.rollback("not-found");
      assert.equal(result, null);
    });
  });

  describe("markFailed", () => {
    it("marks session as failed", () => {
      const session = engine.createSession();
      const ok = engine.markFailed(session.id, "Test failure");
      assert.equal(ok, true);
      const retrieved = engine.getSession(session.id);
      assert.equal(retrieved?.status, "failed");
      assert.equal(retrieved?.failureReason, "Test failure");
    });
  });

  describe("listSessions", () => {
    it("lists only active/preview sessions", async () => {
      const s1 = engine.createSession("s1");
      engine.createSession("s2");
      const s3 = engine.createSession("s3");
      await engine.commit(s1.id);
      await engine.rollback(s3.id);

      const list = engine.listSessions();
      assert.equal(list.length, 1);
      assert.equal(list[0].name, "s2");
    });
  });

  describe("closeSession", () => {
    it("closes active session", () => {
      const session = engine.createSession();
      const ok = engine.closeSession(session.id);
      assert.equal(ok, true);
      const retrieved = engine.getSession(session.id);
      assert.equal(retrieved?.status, "failed");
    });

    it("returns false for unknown session", () => {
      const ok = engine.closeSession("not-found");
      assert.equal(ok, false);
    });
  });
});

describe("P5.3 plan_session tool", () => {
  let base: string;

  beforeEach(() => {
    base = createWorkspace("p53-ps-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  it("start creates session", async () => {
    const out = await planSessionToolHandler({ action: "start", name: "test-plan" });
    const parsed = JSON.parse(out.content[0].text);
    assert.ok(parsed.sessionId);
    assert.equal(parsed.name, "test-plan");
    assert.equal(parsed.status, "active");
  });

  it("list shows active sessions", async () => {
    await planSessionToolHandler({ action: "start" });
    await planSessionToolHandler({ action: "start" });
    const out = await planSessionToolHandler({ action: "list" });
    const parsed = JSON.parse(out.content[0].text);
    assert.ok(parsed.activeSessions >= 2);
  });

  it("preview requires sessionId", async () => {
    await assert.rejects(
      () => planSessionToolHandler({ action: "preview" }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.VALIDATION_FAILED
    );
  });

  it("preview shows staged steps", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    const prevOut = await planSessionToolHandler({ action: "preview", sessionId });
    const parsed = JSON.parse(prevOut.content[0].text);
    assert.equal(parsed.sessionId, sessionId);
    assert.equal(parsed.status, "preview");
    assert.ok(Array.isArray(parsed.steps));
  });

  it("commit commits session", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await planSessionToolHandler({ action: "commit", sessionId });
    const statusOut = await planSessionToolHandler({ action: "status", sessionId });
    const parsed = JSON.parse(statusOut.content[0].text);
    assert.equal(parsed.status, "committed");
  });

  it("rollback rolls back session", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await planSessionToolHandler({ action: "rollback", sessionId });
    const statusOut = await planSessionToolHandler({ action: "status", sessionId });
    const parsed = JSON.parse(statusOut.content[0].text);
    assert.equal(parsed.status, "rolled_back");
  });

  it("close closes session", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await planSessionToolHandler({ action: "close", sessionId });
    const statusOut = await planSessionToolHandler({ action: "status", sessionId });
    const parsed = JSON.parse(statusOut.content[0].text);
    assert.equal(parsed.status, "failed");
  });

  it("invalid action throws", async () => {
    await assert.rejects(
      () => planSessionToolHandler({ action: "evil" as never }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.VALIDATION_FAILED
    );
  });
});

describe("P5.3 execution_preview tool", () => {
  let base: string;

  beforeEach(() => {
    base = createWorkspace("p53-ep-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  it("stages write mutation with dryRun", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;

    const out = await executionPreviewToolHandler({
      sessionId,
      mutations: [{ tool: "write_file", input: { filePath: "new-file.txt", content: "hello world", dryRun: true } }],
    });

    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.stepCount, 1);
    assert.ok(parsed.previews[0].preview.includes("[DRY-RUN]"));
  });

  it("fails if session not active", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await planSessionToolHandler({ action: "commit", sessionId });

    await assert.rejects(
      () => executionPreviewToolHandler({
        sessionId,
        mutations: [{ tool: "write_file", input: { filePath: "x.txt", content: "x", dryRun: true } }],
      }),
      (e: unknown) => e instanceof Error
    );
  });

  it("commit=true applies mutations after preview", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;

    await executionPreviewToolHandler({
      sessionId,
      mutations: [{ tool: "write_file", input: { filePath: "committed.txt", content: "committed content" } }],
      commit: true,
    });

    const filePath = path.join(base, "committed.txt");
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(fs.readFileSync(filePath, "utf8"), "committed content");
  });

  it("fails gracefully when mutation fails", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;

    const out = await executionPreviewToolHandler({
      sessionId,
      mutations: [{ tool: "write_file", input: { filePath: ".env", content: "SECRET=123" } }],
    });

    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.previews[0].success, false);
    assert.ok(parsed.previews[0].error);
  });
});

describe("P5.3 Recovery & Boundaries", () => {
  let base: string;

  beforeEach(() => {
    base = createWorkspace("p53-recovery-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  it("commit without mutations succeeds", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    const commitOut = await planSessionToolHandler({ action: "commit", sessionId });
    const parsed = JSON.parse(commitOut.content[0].text);
    assert.equal(parsed.status, "committed");
    assert.equal(parsed.stepCount, 0);
  });

  it("preview moves session to preview status", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await planSessionToolHandler({ action: "preview", sessionId });
    const statusOut = await planSessionToolHandler({ action: "status", sessionId });
    const parsed = JSON.parse(statusOut.content[0].text);
    assert.equal(parsed.status, "preview");
  });

  it("rollback on empty session completes", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    const rollbackOut = await planSessionToolHandler({ action: "rollback", sessionId });
    const parsed = JSON.parse(rollbackOut.content[0].text);
    assert.equal(parsed.status, "rolled_back");
    assert.equal(parsed.restored.length, 0);
  });

  it("dry-run mutation does not modify filesystem", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await executionPreviewToolHandler({
      sessionId,
      mutations: [{ tool: "write_file", input: { filePath: "should-not-exist.txt", content: "nope", dryRun: true } }],
    });
    const filePath = path.join(base, "should-not-exist.txt");
    assert.equal(fs.existsSync(filePath), false);
  });

  it("status returns complete session snapshot", async () => {
    const startOut = await planSessionToolHandler({ action: "start", name: "my-session" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    const statusOut = await planSessionToolHandler({ action: "status", sessionId });
    const parsed = JSON.parse(statusOut.content[0].text);
    assert.equal(parsed.sessionId, sessionId);
    assert.equal(parsed.name, "my-session");
    assert.equal(parsed.status, "active");
    assert.equal(parsed.stepCount, 0);
    assert.ok(parsed.createdAt);
  });

  it("committed session cannot be re-committed", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await planSessionToolHandler({ action: "commit", sessionId });
    await assert.rejects(
      () => planSessionToolHandler({ action: "commit", sessionId }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.VALIDATION_FAILED
    );
  });

  it("failed session cannot be committed", async () => {
    const startOut = await planSessionToolHandler({ action: "start" });
    const sessionId = JSON.parse(startOut.content[0].text).sessionId;
    await executionPreviewToolHandler({
      sessionId,
      mutations: [{ tool: "write_file", input: { filePath: ".env", content: "SECRET=123" } }],
    });
    await assert.rejects(
      () => planSessionToolHandler({ action: "commit", sessionId }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.VALIDATION_FAILED
    );
  });
});