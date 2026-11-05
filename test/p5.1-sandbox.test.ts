import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { spawnSync } from "node:child_process";
import { normalizeSafePath } from "../src/core/pathSafety.js";
import { getProtectedPathInfo, getProtectedPathsList } from "../src/core/protectedPaths.js";
import { writeFileToolHandler } from "../src/tools/writeFile.js";
import { deleteFileToolHandler } from "../src/tools/deleteFile.js";
import { moveFileToolHandler } from "../src/tools/moveFile.js";
import { copyFileToolHandler } from "../src/tools/copyFile.js";
import { applyPatchToolHandler } from "../src/tools/applyPatch.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";
import { runCommandToolHandler } from "../src/tools/runCommand.js";
import { PolicyTier } from "../src/core/policyEngine.js";

function createWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setWorkspace(root: string) {
  process.env.ALFA_WORKSPACE_ROOT = root;
}

function workspaceFile(base: string, rel: string, content = "test"): string {
  const resolved = path.join(base, rel);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, "utf8");
  return resolved;
}

describe("P5.1 Sandbox — Protected Path Policy", () => {
  let base: string;

  beforeEach(() => {
    base = createWorkspace("p51-protect-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  describe(".env file protection", () => {
    it("write .env denied by protected path policy", async () => {
      const envPath = path.join(base, ".env");
      await assert.rejects(
        () => writeFileToolHandler({ filePath: envPath, content: "SECRET=123" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("write .env.local denied", async () => {
      const envPath = path.join(base, ".env.local");
      await assert.rejects(
        () => writeFileToolHandler({ filePath: envPath, content: "DEBUG=true" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("delete .env denied", async () => {
      const envPath = workspaceFile(base, ".env", "KEY=value");
      await assert.rejects(
        () => deleteFileToolHandler({ filePath: envPath }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("move .env denied", async () => {
      const src = workspaceFile(base, ".env", "KEY=value");
      const dst = path.join(base, ".env.moved");
      await assert.rejects(
        () => moveFileToolHandler({ from: src, to: dst }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });
  });

  describe(".git directory protection", () => {
    it("write inside .git directory denied", async () => {
      const gitFile = path.join(base, ".git", "config");
      fs.mkdirSync(path.join(base, ".git"), { recursive: true });
      await assert.rejects(
        () => writeFileToolHandler({ filePath: gitFile, content: "corrupt" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("delete .git/config denied", async () => {
      const configFile = workspaceFile(base, ".git/config", "[core]");
      await assert.rejects(
        () => deleteFileToolHandler({ filePath: configFile }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });
  });

  describe("lock file protection", () => {
    it("write package-lock.json denied", async () => {
      const lockPath = path.join(base, "package-lock.json");
      await assert.rejects(
        () => writeFileToolHandler({ filePath: lockPath, content: '{"lockfile":true}' }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("delete package-lock.json denied", async () => {
      const lockPath = workspaceFile(base, "package-lock.json", '{"lockfile":true}');
      await assert.rejects(
        () => deleteFileToolHandler({ filePath: lockPath }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("write pnpm-lock.yaml denied", async () => {
      const lockPath = path.join(base, "pnpm-lock.yaml");
      await assert.rejects(
        () => writeFileToolHandler({ filePath: lockPath, content: "lockfile: true" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("write yarn.lock denied", async () => {
      const lockPath = path.join(base, "yarn.lock");
      await assert.rejects(
        () => writeFileToolHandler({ filePath: lockPath, content: "# yarn lock" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });
  });

  describe("CI/CD config protection", () => {
    it("write .github/workflows CI denied", async () => {
      const wfPath = path.join(base, ".github", "workflows", "ci.yml");
      fs.mkdirSync(path.dirname(wfPath), { recursive: true });
      await assert.rejects(
        () => writeFileToolHandler({ filePath: wfPath, content: "name: CI" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("patch .github/workflows ci.yml denied", async () => {
      const wfPath = workspaceFile(base, ".github/workflows/ci.yml", "name: CI");
      await assert.rejects(
        () => applyPatchToolHandler({ filePath: wfPath, patch: "+new_step:" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("delete .github/workflows ci.yml denied", async () => {
      const wfPath = workspaceFile(base, ".github/workflows/deploy.yml", "name: Deploy");
      await assert.rejects(
        () => deleteFileToolHandler({ filePath: wfPath }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });
  });

  describe("release config protection", () => {
    it("write release.config.js denied", async () => {
      const relPath = path.join(base, "release.config.js");
      await assert.rejects(
        () => writeFileToolHandler({ filePath: relPath, content: "module.exports={}" }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("write .releaserc denied", async () => {
      const relPath = path.join(base, ".releaserc");
      await assert.rejects(
        () => writeFileToolHandler({ filePath: relPath, content: '{"release":{}}' }),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });
  });

  describe("getProtectedPathInfo", () => {
    it("returns info for .env files", () => {
      const info = getProtectedPathInfo(path.join(base, ".env"));
      assert.ok(info?.protected);
      assert.ok(info?.name.includes("env"));
    });

    it("returns info for .git", () => {
      fs.mkdirSync(path.join(base, ".git"), { recursive: true });
      fs.writeFileSync(path.join(base, ".git", "config"), "[core]", "utf8");
      const info = getProtectedPathInfo(path.join(base, ".git", "config"));
      assert.ok(info?.protected);
      assert.ok(info?.name.includes("git"));
    });

    it("returns info for lock files", () => {
      assert.ok(getProtectedPathInfo(path.join(base, "package-lock.json"))?.protected);
      assert.ok(getProtectedPathInfo(path.join(base, "pnpm-lock.yaml"))?.protected);
      assert.ok(getProtectedPathInfo(path.join(base, "yarn.lock"))?.protected);
    });

    it("returns undefined for normal files", () => {
      const info = getProtectedPathInfo(path.join(base, "src", "index.ts"));
      assert.equal(info?.protected, undefined);
    });
  });

  describe("getProtectedPathsList", () => {
    it("returns documented list with no raw workspace paths", () => {
      const list = getProtectedPathsList();
      assert.ok(Array.isArray(list));
      assert.ok(list.length > 0);
      for (const item of list) {
        assert.ok(typeof item.name === "string");
        assert.ok(typeof item.description === "string");
        const baseSlash = base.replace(/\\/g, "/");
        assert.ok(!item.name.includes(baseSlash), `name contains workspace path: ${item.name}`);
        assert.ok(!item.description.includes(baseSlash), `description contains workspace path: ${item.description}`);
      }
    });
  });
});

describe("P5.1 Sandbox — Dry-Run Support", () => {
  let base: string;

  beforeEach(() => {
    base = createWorkspace("p51-dryrun-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  it("write_file dryRun does not create file", async () => {
    const filePath = path.join(base, "drytest.txt");
    await writeFileToolHandler({ filePath, content: "hello", dryRun: true });
    assert.equal(fs.existsSync(filePath), false);
  });

  it("write_file dryRun returns planned action", async () => {
    const filePath = path.join(base, "planned.txt");
    const out = await writeFileToolHandler({ filePath, content: "hello", dryRun: true });
    assert.ok(out.content[0].text.includes("[DRY-RUN]"));
    assert.ok(out.content[0].text.includes("drytest.txt") || out.content[0].text.includes("planned.txt"));
  });

  it("delete_file dryRun does not delete file", async () => {
    const filePath = workspaceFile(base, "exist.txt", "content");
    await deleteFileToolHandler({ filePath, dryRun: true });
    assert.equal(fs.existsSync(filePath), true);
  });

  it("delete_file dryRun returns planned action", async () => {
    const filePath = path.join(base, "ghost.txt");
    const out = await deleteFileToolHandler({ filePath, dryRun: true });
    assert.ok(out.content[0].text.includes("[DRY-RUN]"));
    assert.ok(out.content[0].text.includes("ghost.txt"));
  });

  it("move_file dryRun does not move file", async () => {
    const src = workspaceFile(base, "move-src.txt", "src content");
    const dst = path.join(base, "move-dst.txt");
    await moveFileToolHandler({ from: src, to: dst, dryRun: true });
    assert.equal(fs.existsSync(src), true);
    assert.equal(fs.existsSync(dst), false);
  });

  it("move_file dryRun returns planned action", async () => {
    const src = path.join(base, "a.txt");
    const dst = path.join(base, "b.txt");
    const out = await moveFileToolHandler({ from: src, to: dst, dryRun: true });
    assert.ok(out.content[0].text.includes("[DRY-RUN]"));
    assert.ok(out.content[0].text.includes("a.txt"));
    assert.ok(out.content[0].text.includes("b.txt"));
  });

  it("copy_file dryRun does not copy file", async () => {
    const src = workspaceFile(base, "copy-src.txt", "src content");
    const dst = path.join(base, "copy-dst.txt");
    await copyFileToolHandler({ from: src, to: dst, dryRun: true });
    assert.equal(fs.existsSync(src), true);
    assert.equal(fs.existsSync(dst), false);
  });

  it("copy_file dryRun returns planned action", async () => {
    const src = path.join(base, "src.txt");
    const dst = path.join(base, "dst.txt");
    const out = await copyFileToolHandler({ from: src, to: dst, dryRun: true });
    assert.ok(out.content[0].text.includes("[DRY-RUN]"));
    assert.ok(out.content[0].text.includes("src.txt"));
  });

  it("apply_patch dryRun does not modify file", async () => {
    const filePath = workspaceFile(base, "patch-test.txt", "line1\nline2\nline3");
    await applyPatchToolHandler({ filePath, patch: "-line2", dryRun: true });
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(content.includes("line2"));
  });

  it("apply_patch dryRun returns planned action", async () => {
    const filePath = workspaceFile(base, "planned.txt", "old content");
    const out = await applyPatchToolHandler({ filePath, patch: "-old\n+new", dryRun: true });
    assert.ok(out.content[0].text.includes("[DRY-RUN]"));
    assert.ok(out.content[0].text.includes("planned.txt"));
  });

  it("dryRun on protected path still denies", async () => {
    const envPath = path.join(base, ".env");
    await assert.rejects(
      () => writeFileToolHandler({ filePath: envPath, content: "SECRET=123", dryRun: true }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
    );
  });
});

describe("P5.1 Sandbox — Workspace Jail (regression)", () => {
  let base: string;

  beforeEach(() => {
    base = createWorkspace("p51-jail-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  it("normal file write still works", async () => {
    const filePath = path.join(base, "allowed.txt");
    await writeFileToolHandler({ filePath, content: "hello" });
    assert.equal(fs.readFileSync(filePath, "utf8"), "hello");
  });

  it("normal file delete still works", async () => {
    const filePath = workspaceFile(base, "to-delete.txt", "content");
    await deleteFileToolHandler({ filePath });
    assert.equal(fs.existsSync(filePath), false);
  });

  it("symlink escape blocked at write time", () => {
    const outsideDir = createWorkspace("p51-out-");
    const target = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(target, "secret", "utf8");
    const linkPath = path.join(base, "link.txt");
    try { fs.symlinkSync(target, linkPath); } catch { return; }

    assert.throws(
      () => normalizeSafePath(linkPath, { allowedBase: base, rejectSymlinkEscapes: true }),
      /symlink points outside/i
    );
  });

  it("no raw absolute path leaks in protected path error", async () => {
    const envPath = path.join(base, ".env");
    try {
      await writeFileToolHandler({ filePath: envPath, content: "SECRET=123" });
    } catch (e) {
      const norm = ToolExecutionErrorClass.from(e, { defaultTool: "write_file" });
      const msg = norm.toJSON().message;
      assert.ok(!msg.includes(base.replace(/\\/g, "/")));
      assert.ok(!msg.includes("C:") || !msg.includes("Users"));
    }
  });

  it("sibling-path bypass blocked", () => {
    const sibling = `${base}-sibling`;
    fs.mkdirSync(sibling, { recursive: true });
    assert.throws(
      () => normalizeSafePath(sibling, { allowedBase: base }),
      /outside allowed workspace/i
    );
  });

  it("Windows drive mismatch blocked", () => {
    if (process.platform !== "win32") return;
    assert.throws(
      () => normalizeSafePath("D:\\other\\file.txt", { allowedBase: base }),
      /different drive/i
    );
  });

  it("UNC path blocked", () => {
    if (process.platform !== "win32") return;
    assert.throws(
      () => normalizeSafePath("\\\\server\\share\\file.txt", { allowedBase: base }),
      /UNC\/network/i
    );
  });
});

describe("P5.1 Sandbox — Command Sandbox", () => {
  const oldPath = process.env.PATH;
  const oldPathWin = (process.env as Record<string, string | undefined>).Path;
  const oldPathext = process.env.PATHEXT;
  let fakeBin: string;
  let fakeNpmAvailable = false;

  beforeEach(() => {
    fakeBin = createWorkspace("p51-fakebin-");
    const npmCmd = path.join(fakeBin, "npm.cmd");
    const npmSh = path.join(fakeBin, "npm");
    const script = [
      "@echo off",
      "if \"%1\"==\"test\" echo OK && exit /b 0",
      "if \"%1\"==\"run\" if \"%2\"==\"build\" (echo BUILD && exit /b 0)",
      "if \"%1\"==\"run\" if \"%2\"==\"test\" (echo TEST && exit /b 0)",
      "if \"%1\"==\"install\" echo CWD:%CD% && exit /b 0",
      "exit /b 1",
    ].join("\r\n");

    fs.writeFileSync(npmCmd, script, "utf8");
    fs.writeFileSync(npmSh, "#!/usr/bin/env sh\necho OK\n", "utf8");
    try { fs.chmodSync(npmSh, 0o755); } catch {}

    if (process.platform === "win32") {
      (process.env as Record<string, string | undefined>).Path = `${fakeBin};${oldPathWin ?? oldPath ?? ""}`;
      process.env.PATH = `${fakeBin};${oldPath ?? oldPathWin ?? ""}`;
      process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    } else {
      process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    }

    const probe = spawnSync("npm", ["test"], { encoding: "utf8" });
    fakeNpmAvailable = !probe.error;
  });

  afterEach(() => {
    process.env.PATH = oldPath;
    (process.env as Record<string, string | undefined>).Path = oldPathWin;
    process.env.PATHEXT = oldPathext;
  });

  it("unknown commandId denied", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ commandId: "evil_cmd", timeout: 5000 }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.COMMAND_DENIED
    );
  });

  it("command injection blocked", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ command: "npm test && whoami", timeout: 5000 }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.COMMAND_DENIED
    );
  });

  it("command cwd locked to workspace root", async () => {
    if (!fakeNpmAvailable) return;
    const out = await runCommandToolHandler({ commandId: "npm_install", timeout: 5000 });
    const workspace = process.cwd().replace(/\\/g, "/");
    assert.ok(out.content[0].text.includes(`CWD:${workspace}`) || out.content[0].text.includes(`CWD:${process.cwd()}`));
  });

  it("shell not used (shell: false)", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ command: "echo $SHELL", timeout: 5000 }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.COMMAND_DENIED
    );
  });
});

describe("P5.2 Approval Override — Protected Path Escalation", () => {
  let base: string;

  function makeContext(isApproved: boolean, tier: PolicyTier): unknown {
    return {
      requestId: "req-test",
      signal: undefined,
      trace: { traceId: "t", spanId: "s", requestId: "req-test" },
      metadata: {
        requestId: "req-test",
        toolName: "write_file",
        startTime: Date.now(),
        timeoutMs: 30000,
        depth: 1,
        policyTier: tier,
        traceId: "t",
        spanId: "s",
      },
      approval: { isApproved },
    };
  }

  beforeEach(() => {
    base = createWorkspace("p52-override-");
    setWorkspace(base);
  });

  afterEach(() => {
    delete process.env.ALFA_WORKSPACE_ROOT;
  });

  describe("write_file with approval context", () => {
    it("denies .env without approval", async () => {
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123" }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("allows .env with dangerous approval", async () => {
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      const envPath = path.join(base, ".env");
      await writeFileToolHandler({ filePath: envPath, content: "SECRET=123" }, ctx as never);
      assert.equal(fs.readFileSync(envPath, "utf8"), "SECRET=123");
    });

    it("allows .env with system_sensitive approval", async () => {
      const ctx = makeContext(true, PolicyTier.SYSTEM_SENSITIVE);
      const envPath = path.join(base, ".env");
      await writeFileToolHandler({ filePath: envPath, content: "SECRET=123" }, ctx as never);
      assert.equal(fs.readFileSync(envPath, "utf8"), "SECRET=123");
    });

    it("denies .env with read_only approval (insufficient tier)", async () => {
      const ctx = makeContext(true, PolicyTier.READ_ONLY);
      await assert.rejects(
        () => writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123" }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("denies .env with safe_write approval (insufficient tier)", async () => {
      const ctx = makeContext(true, PolicyTier.SAFE_WRITE);
      await assert.rejects(
        () => writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123" }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("denies package-lock.json without approval", async () => {
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => writeFileToolHandler({ filePath: path.join(base, "package-lock.json"), content: "{}" }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("allows package-lock.json with dangerous approval", async () => {
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      const lockPath = path.join(base, "package-lock.json");
      await writeFileToolHandler({ filePath: lockPath, content: '{"lockfile":true}' }, ctx as never);
      assert.equal(fs.readFileSync(lockPath, "utf8"), '{"lockfile":true}');
    });
  });

  describe("delete_file with approval context", () => {
    it("denies .git/config delete without approval", async () => {
      fs.mkdirSync(path.join(base, ".git"), { recursive: true });
      fs.writeFileSync(path.join(base, ".git", "config"), "[core]", "utf8");
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => deleteFileToolHandler({ filePath: path.join(base, ".git", "config") }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("allows .git/config delete with dangerous approval", async () => {
      fs.mkdirSync(path.join(base, ".git"), { recursive: true });
      fs.writeFileSync(path.join(base, ".git", "config"), "[core]", "utf8");
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      await deleteFileToolHandler({ filePath: path.join(base, ".git", "config") }, ctx as never);
      assert.equal(fs.existsSync(path.join(base, ".git", "config")), false);
    });

    it("denies CI workflow delete without approval", async () => {
      const wfPath = workspaceFile(base, ".github/workflows/ci.yml", "name: CI");
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => deleteFileToolHandler({ filePath: wfPath }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("allows CI workflow delete with dangerous approval", async () => {
      const wfPath = workspaceFile(base, ".github/workflows/ci.yml", "name: CI");
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      await deleteFileToolHandler({ filePath: wfPath }, ctx as never);
      assert.equal(fs.existsSync(wfPath), false);
    });
  });

  describe("move_file with approval context", () => {
    it("denies .env move without approval", async () => {
      const src = workspaceFile(base, ".env", "SECRET=123");
      const dst = path.join(base, ".env.moved");
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => moveFileToolHandler({ from: src, to: dst }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("allows .env move with dangerous approval", async () => {
      const src = workspaceFile(base, ".env", "SECRET=123");
      const dst = path.join(base, ".env.moved");
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      await moveFileToolHandler({ from: src, to: dst }, ctx as never);
      assert.equal(fs.existsSync(src), false);
      assert.equal(fs.existsSync(dst), true);
    });
  });

  describe("copy_file with approval context", () => {
    it("denies lock file copy without approval", async () => {
      const src = workspaceFile(base, "normal.txt", "content");
      const dst = path.join(base, "yarn.lock");
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => copyFileToolHandler({ from: src, to: dst }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("allows lock file copy with dangerous approval", async () => {
      const src = workspaceFile(base, "normal.txt", "content");
      const dst = path.join(base, "yarn.lock");
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      await copyFileToolHandler({ from: src, to: dst }, ctx as never);
      assert.equal(fs.existsSync(dst), true);
    });
  });

  describe("apply_patch with approval context", () => {
    it("denies CI workflow patch without approval", async () => {
      const wfPath = workspaceFile(base, ".github/workflows/deploy.yml", "name: Deploy");
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => applyPatchToolHandler({ filePath: wfPath, patch: "+new_step:" }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("allows CI workflow patch with dangerous approval", async () => {
      const wfPath = workspaceFile(base, ".github/workflows/deploy.yml", "name: Deploy\nsteps:");
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      await applyPatchToolHandler({ filePath: wfPath, patch: "+  - new_step:" }, ctx as never);
      const content = fs.readFileSync(wfPath, "utf8");
      assert.ok(content.includes("new_step"));
    });
  });

  describe("dryRun bypasses protected check but respects approval context", () => {
    it("dryRun on .env without approval still denies", async () => {
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      await assert.rejects(
        () => writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123", dryRun: true }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("dryRun on .env with approval allows dry-run planning", async () => {
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      const out = await writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123", dryRun: true }, ctx as never);
      assert.ok(out.content[0].text.includes("[DRY-RUN]"));
    });

    it("dryRun does not create file even with approval", async () => {
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      const envPath = path.join(base, ".env");
      await writeFileToolHandler({ filePath: envPath, content: "SECRET=123", dryRun: true }, ctx as never);
      assert.equal(fs.existsSync(envPath), false);
    });
  });

  describe("ToolRegistry integration — full approval flow", () => {
    it("protected path denied even when tool has safe_write tier but no approval", async () => {
      const ctx = makeContext(false, PolicyTier.SAFE_WRITE);
      await assert.rejects(
        () => writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123" }, ctx as never),
        (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
      );
    });

    it("protected path allowed when approval is present with dangerous tier", async () => {
      const ctx = makeContext(true, PolicyTier.DANGEROUS);
      const envPath = path.join(base, ".env");
      await writeFileToolHandler({ filePath: envPath, content: "SECRET=123" }, ctx as never);
      assert.equal(fs.readFileSync(envPath, "utf8"), "SECRET=123");
    });
  });

  describe("approval summary includes protected path context", () => {
    it("PATH_DENIED for protected path includes pathType in details", async () => {
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      try {
        await writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123" }, ctx as never);
        assert.fail("should have thrown");
      } catch (e) {
        const norm = ToolExecutionErrorClass.from(e, { defaultTool: "write_file" });
        const details = norm.toJSON().details as Record<string, unknown> | undefined;
        assert.ok(details?.pathType);
        assert.ok(String(details?.pathType).includes("env"));
      }
    });

    it("PATH_DENIED includes requiresApproval flag", async () => {
      const ctx = makeContext(false, PolicyTier.DANGEROUS);
      try {
        await writeFileToolHandler({ filePath: path.join(base, ".env"), content: "SECRET=123" }, ctx as never);
        assert.fail("should have thrown");
      } catch (e) {
        const norm = ToolExecutionErrorClass.from(e, { defaultTool: "write_file" });
        const details = norm.toJSON().details as Record<string, unknown> | undefined;
        assert.equal(details?.requiresApproval, true);
      }
    });
  });
});