import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const raw = readFileSync(new URL('./skill-install-copy.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const secret = 'tc_sk_' + 'B'.repeat(43);
const skill = { id: '101', mcpEnabled: true, installable: true, installPath: '/api/skill-library/101/SKILL.md', mcpEndpoint: 'https://flowlight.example/mcp/skills/101' };

function setup(options = {}) {
  const state = { token: options.guest ? null : 'session-A', user: options.guest ? null : { id: '42' } };
  const copied = [], requests = [], controller = new AbortController();
  const modules = {
    '@/lib/clipboard': { copyText: async (text, canCopy) => {
      assert.equal(typeof canCopy, 'function');
      if (!canCopy()) return false;
      await options.beforeClipboardComplete?.(state, controller);
      if (!canCopy()) return false;
      copied.push(text); return options.clipboardOK !== false;
    } },
    '@/lib/http': { getAccessToken: () => state.token },
    '@/stores/use-auth-store': { useAuthStore: { getState: () => state } },
    '@/lib/skill-library-api': {
      skillInstallURL: s => s.installable === true ? 'https://flowlight.example' + s.installPath : '',
      skillLibraryApi: { get: async (id, signal) => {
        requests.push({ operation: 'skill', id, signal });
        await options.afterSkill?.(state, controller);
        return options.metadata || { success: true, data: { ...skill } };
      } },
      skillInstallPrompt: (url, key) => 'install:' + url + ':' + (key || ''),
      skillCodexConfig: (s, key) => 'codex:' + s.mcpEndpoint + ':' + (key || ''),
      skillMCPConfig: (s, key) => 'mcp:' + s.mcpEndpoint + ':' + (key || ''),
    },
    '@/lib/user-api-key': { userApiKeyApi: {
      get: async (id, signal) => {
        requests.push({ operation: 'get', id, signal });
        await options.afterGet?.(state, controller);
        return options.info || { success: true, data: { revision: 2, enabled: !options.disabled } };
      },
      reveal: async (id, revision, signal) => {
        requests.push({ operation: 'reveal', id, revision, signal });
        await options.afterReveal?.(state, controller);
        return options.revealed || { success: true, data: { revision: 2, key: secret } };
      },
    } },
  };
  const context = { URL, exports: {}, require: name => { assert.ok(modules[name], name); return modules[name]; } };
  vm.createContext(context); vm.runInContext(code, context);
  return { state, copied, requests, controller, copy: (format = 'install', selected = skill) => context.exports.copySkillSetup(selected, 'https://flowlight.example', format, controller.signal) };
}

test('explicit copy fetches the current owner key and revision, then personalizes each copy format', async () => {
  for (const format of ['install', 'codex', 'mcp']) {
    const env = setup(); const result = await env.copy(format);
    assert.equal(result.includesKey, true);
    assert.equal(env.copied.length, 1); assert.ok(env.copied[0].includes(secret));
    assert.deepEqual(env.requests.map(r => [r.operation, r.id, r.revision]), [['skill', '101', undefined], ['get', '42', undefined], ['reveal', '42', 2]]);
    assert.ok(env.requests.every(r => r.signal === env.controller.signal));
  }
});

test('guest copies remain public and never call the key service', async () => {
  const env = setup({ guest: true }); const result = await env.copy();
  assert.equal(result.includesKey, false); assert.deepEqual(env.requests.map(r => r.operation), ['skill']);
  assert.ok(!env.copied[0].includes(secret));
});

test('switching accounts or credentials while either key request is pending prevents copying', async () => {
  for (const stage of ['afterSkill', 'afterGet', 'afterReveal']) {
    for (const change of [s => { s.user = { id: '43' }; }, s => { s.token = 'session-B'; }, s => { s.user = null; s.token = null; }]) {
      const env = setup({ [stage]: change });
      await assert.rejects(env.copy(), /登录状态已变化/);
      assert.equal(env.copied.length, 0);
      if (stage === 'afterSkill') assert.equal(env.requests.length, 1);
      if (stage === 'afterGet') assert.equal(env.requests.length, 2);
    }
  }
});

test('cancelled, failed or stale reveals never enter the clipboard', async () => {
  const cases = [
    { afterReveal: (_, controller) => controller.abort() },
    { revealed: { success: false, message: '密钥已变化' } },
    { revealed: { success: true, data: { revision: 3, key: secret } } },
    { revealed: { success: true, data: { revision: 2, key: 'sk-provider-secret' } } },
    { info: { success: false, message: '读取失败' } },
    { info: { success: true, data: { revision: null, enabled: true } } },
  ];
  for (const options of cases) { const env = setup(options); await assert.rejects(env.copy()); assert.equal(env.copied.length, 0); }
});

test('disabled owner keys can be copied with their status without being enabled or rotated', async () => {
  const env = setup({ disabled: true }); const result = await env.copy();
  assert.equal(result.includesKey, true); assert.equal(result.keyEnabled, false);
  assert.ok(env.copied[0].includes('当前已停用'));
  assert.deepEqual(env.requests.map(r => r.operation), ['skill', 'get', 'reveal']);
});

test('unavailable Skill and clipboard failures are surfaced without claiming success', async () => {
  const hidden = setup(); await assert.rejects(hidden.copy('install', { ...skill, installable: false }));
  assert.equal(hidden.requests.length, 0); assert.equal(hidden.copied.length, 0);
  const blocked = setup({ clipboardOK: false }); await assert.rejects(blocked.copy(), /复制失败/);
});

test('copy uses the newest MCP address instead of stale page data', async () => {
  const latest = { ...skill, mcpEndpoint: 'https://new-mcp.example/mcp/skills/101' };
  for (const format of ['codex', 'mcp']) {
    const env = setup({ metadata: { success: true, data: latest } });
    await env.copy(format);
    assert.ok(env.copied[0].includes(latest.mcpEndpoint));
    assert.ok(!env.copied[0].includes(skill.mcpEndpoint));
  }
});

test('disabled, missing, mismatched or malformed current metadata blocks revealing a key', async () => {
  const cases = [
    { success: false, code: 404, message: '技能已关闭' },
    { success: true, data: { ...skill, id: '102' } },
    { success: true, data: { ...skill, mcpEnabled: false } },
    { success: true, data: { ...skill, installable: false } },
    { success: true, data: { ...skill, installable: 'false' } },
    { success: true, data: { ...skill, installPath: '/api/skill-library/102/SKILL.md' } },
    { success: true, data: { ...skill, mcpEndpoint: 'javascript:alert(1)' } },
    { success: true, data: { ...skill, mcpEndpoint: 'https://flowlight.example/mcp/skills/102' } },
    { success: true, data: { ...skill, mcpEndpoint: 'https://user:secret@flowlight.example/mcp/skills/101' } },
    { success: true, data: { ...skill, mcpEndpoint: 'https://flowlight.example/mcp/skills/101?key=secret' } },
  ];
  for (const metadata of cases) {
    const env = setup({ metadata }); await assert.rejects(env.copy());
    assert.deepEqual(env.requests.map(r => r.operation), ['skill']);
    assert.equal(env.copied.length, 0);
  }
});

test('an unconfigured MCP still allows installation but never copies an empty MCP configuration', async () => {
  const metadata = { success: true, data: { ...skill, mcpEndpoint: '' } };
  const install = setup({ metadata }); await install.copy(); assert.equal(install.copied.length, 1);
  const manual = setup({ metadata }); await assert.rejects(manual.copy('codex'), /地址尚未配置/);
  assert.deepEqual(manual.requests.map(r => r.operation), ['skill']);
  assert.equal(manual.copied.length, 0);
});

test('session changes and cancellation while clipboard permissions are pending stop fallback copying', async () => {
  for (const change of [s => { s.user = null; s.token = null; }, s => { s.user = { id: '43' }; s.token = 'session-B'; }, (_, controller) => controller.abort()]) {
    const env = setup({ beforeClipboardComplete: change });
    await assert.rejects(env.copy());
    assert.equal(env.copied.length, 0);
  }
});
