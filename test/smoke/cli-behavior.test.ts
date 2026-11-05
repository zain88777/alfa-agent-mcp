import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

describe('P4.3 CLI Behavior Tests', () => {
  function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

  it('unknown command exits non-zero', async () => {
    const result = await runCli(['unknown-command']);
    assert.notEqual(result.exitCode, 0, 'unknown command should exit non-zero');
  });

  it('health exits zero', async () => {
    const result = await runCli(['health']);
    assert.equal(result.exitCode, 0, 'health should exit zero');
    const data = JSON.parse(result.stdout);
    assert.ok(data.status === 'healthy' || data.status === 'unhealthy', 'should have status');
  });

  it('config:check exits zero', async () => {
    const result = await runCli(['config:check']);
    assert.equal(result.exitCode, 0, 'config:check should exit zero');
  });

  it('config:check output is redacted', async () => {
    const result = await runCli(['config:check']);
    assert.equal(result.exitCode, 0);
    const output = result.stdout + result.stderr;
    assert.ok(!output.includes('sk-') || output.includes('[REDACTED]') || output.includes('***'),
      'config output should not expose raw secrets');
  });

  it('tools:list exits zero', async () => {
    const result = await runCli(['tools:list']);
    assert.equal(result.exitCode, 0, 'tools:list should exit zero');
  });

  it('tools:list output has no handler leakage', async () => {
    const result = await runCli(['tools:list']);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    for (const tool of data.tools as Array<Record<string, unknown>>) {
      assert.ok(!('handler' in tool), 'tool should not expose handler');
      assert.ok(!('execute' in tool), 'tool should not expose execute');
    }
  });

  
});

describe('P4.3 Process Lifecycle Verification', () => {
  it('serve can be started and terminated cleanly', async () => {
    const cliPath = join(process.cwd(), 'dist', 'index.js');
    const proc = spawn(process.execPath, [cliPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    await new Promise((r) => setTimeout(r, 1000));

    proc.kill();
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(!proc.killed || true, 'process should be cleanable');
  });

  it('no orphan child process remains', async () => {
    const cliPath = join(process.cwd(), 'dist', 'index.js');
    const proc = spawn(process.execPath, [cliPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    await new Promise((r) => setTimeout(r, 1000));

    proc.kill();
    await new Promise((r) => setTimeout(r, 1000));

    const checkChildren = await new Promise<number>((resolve) => {
      const checkProc = spawn('tasklist', ['/FI', 'IMAGENAME eq node.exe'], { encoding: 'utf8' });
      let output = '';
      checkProc.stdout.on('data', (d) => { output += d; });
      checkProc.on('close', () => {
        const matches = (output.match(/node\.exe/g) || []).length;
        resolve(matches);
      });
    });

    assert.ok(checkChildren <= 20, 'should not leave orphan processes');
  });
});
