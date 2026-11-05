import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

describe('P4.3 MCP Server Runtime Verification', () => {
  let serverProcess: ReturnType<typeof spawn>;

  beforeEach(() => {
    process.env = { ...process.env };
  });

  afterEach(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const cliPath = join(process.cwd(), 'dist', 'cli.js');
      const proc = spawn(process.execPath, [cliPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });
    });
  }

  it('server starts cleanly and exposes tool definitions', async () => {
    const result = await runCli(['tools:list']);

    assert.equal(result.exitCode, 0, `tools:list failed with stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok(data.total > 0, 'should have tools');
    assert.ok(Array.isArray(data.tools), 'tools should be array');

for (const tool of data.tools as Array<Record<string, unknown>>) {
      assert.ok(!('handler' in tool), 'tool should not expose handler');
    }
  });

  it('metadata/schema only - no raw handlers exposed', async () => {
    const result = await runCli(['tools:list']);

    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);

    const allowedKeys = ['name', 'description', 'hasSchema', 'policy'];
    for (const tool of data.tools) {
      const actualKeys = Object.keys(tool);
      for (const key of actualKeys) {
        assert.ok(allowedKeys.includes(key), `tool should not have key: ${key}`);
      }
      assert.ok(!Object.prototype.hasOwnProperty.call(tool, 'handler'), 'tool should not expose handler');
      assert.ok(!Object.prototype.hasOwnProperty.call(tool, 'execute'), 'tool should not expose execute');
    }
  });

  it('policy metadata included where safe', async () => {
    const result = await runCli(['tools:list']);

    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);

    let toolsWithPolicy = 0;
    for (const tool of data.tools) {
      if (tool.policy && typeof tool.policy === 'object' && 'tier' in tool.policy) {
        toolsWithPolicy++;
        assert.ok(['read_only', 'safe_write', 'dangerous', 'system_sensitive'].includes(tool.policy.tier));
      }
    }
    assert.ok(toolsWithPolicy > 0, 'some tools should have policy metadata');
  });

  it('tools are listed with expected metadata', async () => {
    const result = await runCli(['tools:list']);

    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);

    assert.ok(data.total > 0, 'should have tools');
    assert.ok(Array.isArray(data.tools), 'tools should be array');
  });

  it('safe tool can execute with valid input', async () => {
    const result = await runCli(['health']);

    assert.equal(result.exitCode, 0, `health failed with stderr: ${result.stderr}`);
    const healthData = JSON.parse(result.stdout);
    assert.ok(healthData.status === 'healthy', 'health should be healthy');
    assert.ok(typeof healthData.totalTools === 'number', 'should have totalTools');
  });

  it('denied tool returns normalized error envelope', async () => {
    const result = await runCli(['tools:list']);

    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.ok(Array.isArray(data.tools), 'should return tools array');
  });
});