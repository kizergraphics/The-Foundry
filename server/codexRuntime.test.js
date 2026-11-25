import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createCodexRuntime, readNativeImage, sanitizedCodexEnvironment, resolveCodexTimeoutMs, hasCodexProviderConflict } from './codexRuntime.js';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function png() { return sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer(); }
async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foundry-runtime-test-')); roots.push(root);
  const requests = []; const children = []; const image = await png();
  let turns = 0;
  const spawnImpl = vi.fn((_exe, _args, spawnOptions) => {
    const child = new EventEmitter(); children.push(child);
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    const send = message => child.stdout.write(`${JSON.stringify(message)}\n`);
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString()); requests.push(message); callback();
      queueMicrotask(async () => {
        if (message.id === undefined || !message.method) return;
        if (options.hang === message.method) return;
        let result = {};
        if (message.method === 'account/read') result = { account: { type: options.account || 'chatgpt', email: 'private@example.com' } };
        if (message.method === 'config/read') result = { config: { mcp_servers: { secret_connector: { enabled: true, url: 'https://example.test' } }, ...(options.providerOverride ? { model_providers: { openai: options.providerOverride } } : {}) } };
        if (message.method === 'thread/start') result = { thread: { id: 'thread-1' } };
        if (message.method === 'turn/start') {
          turns++;
          result = { turn: { id: `turn-${turns}` } };
          if (options.approval) {
            send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1' } });
            return;
          }
          if (options.crash) { child.emit('exit', 1); return; }
          if (options.malformed) { child.stdout.write('not-json\n'); return; }
          const item = options.noImage ? { type: 'agentMessage', id: `text-${turns}`, text: 'C:\\fake.png' }
            : options.text ? { type: 'agentMessage', id: `text-${turns}`, text: 'Generated prompt' }
            : { type: 'imageGeneration', id: `image-${turns}`, status: 'completed', result: image.toString('base64'), revisedPrompt: 'Revised prompt' };
          if (options.saved) {
            const filename = path.join(spawnOptions.cwd, 'native.png'); await fs.writeFile(filename, image);
            item.savedPath = filename; delete item.result;
          }
          send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: `turn-${turns}`, item } });
          send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: `turn-${turns}`, status: options.failed || (options.failSecond && turns === 2) ? 'failed' : 'completed', items: [item] } } });
        }
        send({ id: message.id, result });
      });
    } });
    return child;
  });
  const env = { PATH: process.env.PATH, OPENAI_API_KEY: 'do-not-pass', CODEX_API_KEY: 'do-not-pass', OPENAI_BASE_URL: 'https://bad.test', CODEX_HOME: path.join(root, 'home') };
  const runtime = createCodexRuntime({ spawnImpl, resolveExecutable: async () => 'codex-test', tempRoot: root, timeoutMs: options.environmentTimeout ? undefined : options.timeoutMs || 2000, env });
  return { ...runtime, requests, spawnImpl, children, root, image, env };
}

describe('managed Codex runtime bridge', () => {
  it('reads and caches sanitized managed-account status without starting a turn', async () => {
    const runtime = await fixture();
    const [a, b] = await Promise.all([runtime.getCodexStatus(), runtime.getCodexStatus()]);
    expect(a).toMatchObject({ ready: true, provider: 'codex' }); expect(b).toEqual(a);
    await runtime.getCodexStatus(); expect(runtime.spawnImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(a)).not.toContain('private@example');
    expect(runtime.requests.some(request => request.method === 'turn/start')).toBe(false);
  });
  it('rejects API key authentication without generation', async () => {
    const runtime = await fixture({ account: 'apiKey' });
    expect(await runtime.getCodexStatus()).toMatchObject({ authenticated: false });
    await expect(runtime.generateCodexImages({ prompt: 'tree' })).rejects.toMatchObject({ code: 'CODEX_AUTH_REQUIRED' });
    expect(runtime.requests.some(request => request.method === 'turn/start')).toBe(false);
  });
  it('uses native image items, sequential turns, isolated refs, and no shell interpolation', async () => {
    const runtime = await fixture({ saved: true });
    const result = await runtime.generateCodexImages({ prompt: 'a tree; echo malicious', references: [runtime.image], count: 2 });
    expect(result.images).toHaveLength(2); expect(result.images[0]).toMatchObject({ mimeType: 'image/png', revisedPrompt: 'Revised prompt' });
    const starts = runtime.requests.filter(request => request.method === 'turn/start'); expect(starts).toHaveLength(2);
    expect(starts[0].params.input[1].type).toBe('localImage');
    const start = runtime.requests.find(request => request.method === 'thread/start');
    expect(start.params).toMatchObject({ ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', config: { mcp_servers: { secret_connector: { enabled: false } }, features: { shell_tool: false, unified_exec: false, plugins: false, apps: false, multi_agent: false, browser_use: false, computer_use: false, image_generation: true, code_mode_only: false, code_mode_host: true } } });
    const [, args, spawnOptions] = runtime.spawnImpl.mock.calls[0];
    expect(args).toContain('features.image_generation=true');
    expect(args).toContain('features.code_mode_host=true');
    expect(args).not.toContain('features.code_mode_host=false');
    expect(starts[0].params.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
    expect(args.join(' ')).not.toContain('malicious'); expect(spawnOptions.shell).toBe(false);
    expect(spawnOptions.env.OPENAI_API_KEY).toBeUndefined();
    await expect(fs.stat(spawnOptions.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(runtime.children[0].kill).toHaveBeenCalled();
  });
  it('collects text independently and releases the generation lock', async () => {
    const runtime = await fixture({ text: true });
    expect(await runtime.generateCodexText({ prompt: 'Write a prompt', systemInstruction: 'Be brief' })).toBe('Generated prompt');
    expect(await runtime.generateCodexText({ prompt: 'Write another' })).toBe('Generated prompt');
    expect(runtime.spawnImpl.mock.calls[0][1]).toContain('features.code_mode_host=false');
    expect(runtime.requests.find(request => request.method === 'thread/start').params.config.features.code_mode_host).toBe(false);
  });
  it('preserves completed images when a later sequential generation fails', async () => {
    const runtime = await fixture({ failSecond: true });
    const result = await runtime.generateCodexImages({ prompt: 'tree', count: 3 });
    expect(result.images).toHaveLength(1);
    expect(result.warning).toContain('1 of 3');
    expect(result.warningCode).toBe('CODEX_GENERATION_FAILED');
    expect(runtime.requests.filter(request => request.method === 'turn/start')).toHaveLength(2);
  });
  it('does not mistake assistant text or paths for native generated images', async () => {
    const runtime = await fixture({ noImage: true });
    await expect(runtime.generateCodexImages({ prompt: 'tree' })).rejects.toMatchObject({ code: 'CODEX_NO_IMAGE' });
  });
  it('retains no-image diagnostics internally without exposing them in JSON or spreads', async () => {
    const runtime = await fixture({ noImage: true });
    const error = await runtime.generateCodexImages({ prompt: 'tree' }).catch(error => error);
    expect(error.debugDiagnostics).toEqual({ itemTypes: ['agentMessage'], finalAgentText: 'C:\\fake.png' });
    expect(Object.keys(error)).not.toContain('debugDiagnostics');
    expect({ ...error }).not.toHaveProperty('debugDiagnostics');
    expect(JSON.stringify(error)).not.toContain('fake.png');
  });
  it.each([['approval', 'CODEX_PERMISSION_DENIED'], ['crash', 'CODEX_EXITED'], ['malformed', 'CODEX_PROTOCOL_ERROR'], ['failed', 'CODEX_GENERATION_FAILED']])('fails safely on %s without retry', async (key, code) => {
    const runtime = await fixture({ [key]: true });
    await expect(runtime.generateCodexImages({ prompt: 'tree' })).rejects.toMatchObject({ code });
    expect(runtime.spawnImpl).toHaveBeenCalledTimes(1);
    if (key === 'crash') expect(runtime.children[0].kill).not.toHaveBeenCalled();
    else expect(runtime.children[0].kill).toHaveBeenCalled();
  });
  it('times out and kills a stalled job without retry', async () => {
    const runtime = await fixture({ hang: 'turn/start', timeoutMs: 35 });
    await expect(runtime.generateCodexImages({ prompt: 'tree' })).rejects.toMatchObject({ code: 'CODEX_TIMEOUT' });
    expect(runtime.children[0].kill).toHaveBeenCalled();
  });
  it('resolves timeout settings dynamically after construction and keeps status at 15 seconds', async () => {
    const runtime = await fixture({ text: true, environmentTimeout: true });
    runtime.env.FOUNDRY_CODEX_TIMEOUT_MS = '900000';
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      await runtime.generateCodexText({ prompt: 'Write a prompt' });
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 900_000);
      timer.mockClear();
      runtime.env.FOUNDRY_CODEX_TIMEOUT_MS = '1200000';
      await runtime.generateCodexText({ prompt: 'Write another' });
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 1_200_000);
      timer.mockClear();
      await runtime.getCodexStatus();
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 15_000);
    } finally { timer.mockRestore(); }
  });
  it.each([[undefined, 600_000], ['', 600_000], ['nope', 600_000], ['Infinity', 600_000], ['-10', 600_000], ['1.5', 600_000], ['35', 600_000], ['900000', 900_000], ['9999999', 1_800_000]])('validates and bounds timeout value %s', (value, expected) => {
    expect(resolveCodexTimeoutMs({ FOUNDRY_CODEX_TIMEOUT_MS: value })).toBe(expected);
  });
  it('rejects concurrency and stops on cancellation', async () => {
    const runtime = await fixture({ hang: 'turn/start' }); const controller = new AbortController();
    const running = runtime.generateCodexImages({ prompt: 'tree', signal: controller.signal });
    const rejection = expect(running).rejects.toMatchObject({ code: 'CODEX_CANCELLED' });
    await expect(runtime.generateCodexText({ prompt: 'Another' })).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    controller.abort(); await rejection;
  });
  it('rejects masks rather than silently ignoring them', async () => {
    const runtime = await fixture();
    await expect(runtime.generateCodexImages({ prompt: 'tree', mask: runtime.image })).rejects.toMatchObject({ code: 'CODEX_MASK_UNSUPPORTED' });
    expect(runtime.spawnImpl).not.toHaveBeenCalled();
  });
  it('bounds and validates image content and native paths', async () => {
    const runtime = await fixture(); const filename = path.join(runtime.root, 'outside.png'); await fs.writeFile(filename, runtime.image);
    await expect(readNativeImage({ type: 'imageGeneration', status: 'completed', savedPath: filename }, [path.join(runtime.root, 'other')])).rejects.toMatchObject({ code: 'CODEX_UNSAFE_IMAGE' });
    await expect(readNativeImage({ type: 'imageGeneration', status: 'completed', result: Buffer.from('not an image').toString('base64') }, [])).rejects.toMatchObject({ code: 'CODEX_INVALID_IMAGE' });
    await expect(readNativeImage({ type: 'imageGeneration', status: 'completed', fileId: 'attachment-only' }, [])).rejects.toMatchObject({ code: 'CODEX_IMAGE_UNAVAILABLE' });
  });
  it('rejects stale native files in the shared generated-image folder', async () => {
    const runtime = await fixture(); const filename = path.join(runtime.root, 'old-native.png');
    await fs.writeFile(filename, runtime.image);
    const past = new Date(Date.now() - 60_000); await fs.utimes(filename, past, past);
    const item = { type: 'imageGeneration', status: 'completed', savedPath: filename };
    await expect(readNativeImage(item, [runtime.root], { notBeforeMs: Date.now() })).rejects.toMatchObject({ code: 'CODEX_STALE_IMAGE' });
    await fs.utimes(filename, new Date(), new Date());
    expect((await readNativeImage(item, [runtime.root], { notBeforeMs: Date.now() })).mimeType).toBe('image/png');
  });
  it.each([{ base_url: 'https://untrusted.test' }, { env_key: 'CUSTOM_SECRET' }, { requires_openai_auth: false }])('rejects inherited OpenAI endpoint/auth overrides before a thread or turn starts', async providerOverride => {
    const runtime = await fixture({ providerOverride });
    expect(await runtime.getCodexStatus()).toMatchObject({ ready: false, code: 'CODEX_PROVIDER_CONFLICT' });
    const error = await runtime.generateCodexImages({ prompt: 'tree' }).catch(error => error);
    expect(error.code).toBe('CODEX_PROVIDER_CONFLICT');
    expect(JSON.stringify(error)).not.toContain('untrusted.test');
    expect(JSON.stringify(error)).not.toContain('CUSTOM_SECRET');
    expect(runtime.requests.some(request => ['thread/start', 'turn/start'].includes(request.method))).toBe(false);
  });
  it('allows official merged provider defaults', () => {
    expect(hasCodexProviderConflict({ model_providers: { openai: { base_url: 'https://api.openai.com/v1/', requires_openai_auth: true } } })).toBe(false);
    expect(hasCodexProviderConflict({ model_providers: { openai: { base_url: 'https://chatgpt.com/backend-api/codex' } } })).toBe(false);
  });
  it('strips API-key routes case-insensitively from child env', () => {
    expect(sanitizedCodexEnvironment({ OPENAI_API_KEY: 'x', Codex_Api_Key: 'y', openai_base_url: 'z', PATH: 'kept' })).toEqual({ PATH: 'kept' });
  });
});
