import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const raw = readFileSync(new URL('./skill-library-api.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('library.ts', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(['skillInstallPrompt', 'skillInstallURL', 'skillCodexConfig', 'skillMCPConfig']);
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(source).replace(/^export /, '')).join('\n');
const code = ts.transpileModule(functions + '\nglobalThis.api = {skillInstallPrompt,skillInstallURL,skillCodexConfig,skillMCPConfig};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { URL }; vm.createContext(context); vm.runInContext(code, context);
const { skillInstallPrompt, skillInstallURL, skillCodexConfig, skillMCPConfig } = context.api;

test('one copied instruction installs a real Skill and its uniquely scoped MCP configuration', () => {
  const url = 'https://flowlight.example/api/skill-library/2098715147391471616/SKILL.md';
  const prompt = skillInstallPrompt(url);
  for (const expected of [url, 'name: flowlight-skill-2098715147391471616', '~/.agents/skills/flowlight-skill-2098715147391471616/SKILL.md', 'references/connection.json', 'https://flowlight.example/api/skill-library/2098715147391471616', 'codex mcp add flowlight_skill_2098715147391471616', '--bearer-token-env-var FLOWLIGHT_API_KEY', '$flowlight-skill-2098715147391471616']) {
    assert.ok(prompt.includes(expected), expected);
  }
  const savedSource = JSON.parse(prompt.match(/\{\n  "sourceUrl"[\s\S]*?\n\}/)[0]);
  assert.deepEqual(savedSource, { sourceUrl: url, metadataUrl: 'https://flowlight.example/api/skill-library/2098715147391471616' });
  assert.ok(prompt.includes('保留其他 MCP 配置'));
  assert.ok(prompt.includes('保留本地修改备份'));
});

test('missing credentials or service do not require paid verification or block file installation', () => {
  const prompt = skillInstallPrompt('http://localhost:3000/api/skill-library/101/SKILL.md');
  assert.ok(prompt.includes('先完成安装'));
  assert.ok(prompt.includes('Skill 已安装，MCP 待连接'));
  assert.ok(prompt.includes('只调用 get_skill_info'));
  assert.ok(prompt.includes('不要运行 run_skill 或发起付费任务'));
  assert.ok(prompt.includes('不输出密钥'));
});

test('installation prompts reject credentials, query tokens and non-Skill URLs', () => {
  for (const url of ['', 'not-a-url', 'javascript:alert(1)', 'ftp://example.com/api/skill-library/101/SKILL.md', 'https://user:secret@example.com/api/skill-library/101/SKILL.md', 'https://example.com/api/skill-library/101/SKILL.md?key=secret', 'https://example.com/api/skill-library/101/SKILL.md#secret', 'https://example.com/skills/101', 'https://example.com/api/skill-library/0/SKILL.md']) assert.equal(skillInstallPrompt(url), '', url);
});

test('copy links remain gated by installation availability and the canonical raw document path', () => {
  const skill = { id: '101', installable: true, installPath: '/api/skill-library/101/SKILL.md' };
  assert.equal(skillInstallURL(skill, 'https://flowlight.example'), 'https://flowlight.example/api/skill-library/101/SKILL.md');
  assert.equal(skillInstallURL({ ...skill, installable: false }, 'https://flowlight.example'), '');
  assert.equal(skillInstallURL({ ...skill, installable: 'false' }, 'https://flowlight.example'), '');
  assert.equal(skillInstallURL({ ...skill, installPath: 'https://other.example/SKILL.md' }, 'https://flowlight.example'), '');
});

test('personalized installation and MCP copies use the supplied user key only in private configuration', () => {
  const key = 'tc_sk_' + 'A'.repeat(43);
  const url = 'https://flowlight.example/api/skill-library/101/SKILL.md';
  const skill = { id: '101', mcpEndpoint: 'https://flowlight.example/mcp/skills/101' };
  const personalized = skillInstallPrompt(url, key);
  assert.ok(personalized.includes(key));
  assert.ok(personalized.includes('http_headers'));
  assert.ok(personalized.includes('不要输出或复述密钥'));
  assert.ok(!personalized.includes('--bearer-token-env-var FLOWLIGHT_API_KEY'));
  const sourceRecord = JSON.parse(personalized.match(/\{\n  "sourceUrl"[\s\S]*?\n\}/)[0]);
  assert.ok(!JSON.stringify(sourceRecord).includes(key));
  const toml = skillCodexConfig(skill, key);
  assert.ok(toml.includes('Authorization = "Bearer ' + key + '"'));
  assert.ok(!toml.includes('bearer_token_env_var'));
  assert.equal(JSON.parse(skillMCPConfig(skill, key)).mcpServers.flowlight_skill_101.headers.Authorization, 'Bearer ' + key);
  for (const preview of [skillInstallPrompt(url), skillCodexConfig(skill), skillMCPConfig(skill)]) assert.ok(!preview.includes(key));
});

test('missing MCP is installed automatically while existing connections and user disablement are respected', () => {
  for (const key of [undefined, 'tc_sk_' + 'A'.repeat(43)]) {
    const prompt = skillInstallPrompt('https://flowlight.example/api/skill-library/101/SKILL.md', key);
    for (const expected of ['codex mcp get flowlight_skill_101 --json', '连接不存在时，直接执行 codex mcp add flowlight_skill_101', '连接已存在且地址一致时复用', 'mcp_servers.flowlight_skill_101', '保留其他 MCP 配置', '显式停用', '每次使用 Skill 时', '自动修复一次', '需重新连接或开启新会话', '不要把写入配置当成已连通']) assert.ok(prompt.includes(expected), expected);
  }
  const existing = skillInstallPrompt('https://flowlight.example/api/skill-library/101/SKILL.md');
  assert.ok(existing.includes('优先保留本技能现有的本地鉴权配置'));
  assert.ok(existing.includes('不要用示例环境变量覆盖已有的 http_headers'));
});
