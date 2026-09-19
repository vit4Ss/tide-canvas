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
  for (const expected of [url, 'data.skillName', '<skillName>/SKILL.md', 'references/connection.json', 'https://flowlight.example/api/skill-library/2098715147391471616', 'flowlight_skill_2098715147391471616', 'FLOWLIGHT_API_KEY', 'MCP Streamable HTTP']) {
    assert.ok(prompt.includes(expected), expected);
  }
  const savedSource = JSON.parse(prompt.match(/\{\n  "sourceUrl"[\s\S]*?\n\}/)[0]);
  assert.deepEqual(savedSource, { sourceUrl: url, metadataUrl: 'https://flowlight.example/api/skill-library/2098715147391471616' });
  assert.ok(prompt.includes('保留其他 MCP 配置'));
  assert.ok(prompt.includes('保留本地修改备份'));
});

test('installed names come from current metadata and existing unrelated skills cannot be overwritten', () => {
  const prompt = skillInstallPrompt('https://flowlight.example/api/skill-library/2098715147391471616/SKILL.md');
  for (const expected of ['data.skillName', 'YAML name 必须与 skillName 一致', '同一源站', 'skill-id', '不同来源', '不得覆盖', 'flowlight-skill-2098715147391471616', '技能扫描目录之外', '名称不一致时重新读取一次']) assert.ok(prompt.includes(expected), expected);
  assert.ok(!prompt.includes('name: flowlight-skill-2098715147391471616'));
  assert.ok(!prompt.includes('安装为 flowlight-skill-2098715147391471616/SKILL.md'));
  assert.ok(prompt.includes('连接标识 flowlight_skill_2098715147391471616'));
});

test('missing credentials or service do not require paid verification or block file installation', () => {
  const prompt = skillInstallPrompt('http://localhost:3000/api/skill-library/101/SKILL.md');
  assert.ok(prompt.includes('先完成可完成的安装'));
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
  assert.ok(personalized.includes('当前客户端支持的安全凭据存储'));
  assert.ok(personalized.includes('Authorization: Bearer'));
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
    for (const expected of ['先确认当前客户端', '当前客户端的 MCP/扩展/连接器管理工具', '只有明确确认连接不存在时才新增', '连接已存在且地址一致时复用', 'flowlight_skill_101', '保留其他 MCP 配置', '显式停用', '每次使用 Skill 时', '自动修复一次', '需重新连接或开启新会话', '不要把写入配置当成已连通']) assert.ok(prompt.includes(expected), expected);
    for (const forbidden of ['codex mcp', 'config.toml', '~/.codex', '~/.agents', 'mcp_servers.', '--bearer-token-env-var']) assert.ok(!prompt.includes(forbidden), forbidden);
    assert.ok(prompt.indexOf('先确认当前客户端') < prompt.indexOf('下载上述链接'));
    assert.ok(prompt.includes('当前客户端不支持本地 Skill'));
    assert.ok(prompt.includes('不修改其他智能体的配置'));
    assert.ok(prompt.includes('版本号相同也要比较文档内容'));
  }
  const existing = skillInstallPrompt('https://flowlight.example/api/skill-library/101/SKILL.md');
  assert.ok(existing.includes('优先保留本技能现有的鉴权配置'));
  assert.ok(existing.includes('不要覆盖已有有效鉴权'));
});

test('client capabilities, metadata and the exact skill identity gate connection success', () => {
  const prompt = skillInstallPrompt('https://flowlight.example/api/skill-library/2098715147391471616/SKILL.md');
  for (const expected of [
    '不要把仅支持本地进程的 MCP 等同于支持远程 HTTP',
    '只支持远程 MCP 时跳过本地 Skill 目录创建',
    '不提前报告“已接入”',
    '只支持 Skill、不支持本服务的远程 MCP',
    '当前客户端无法执行此云端技能',
    '两者都不支持时说明限制，不创建无效配置',
    '没有本地技能目录时不要求这个文件',
    'data.id 为字符串 "2098715147391471616"',
    'data.mcpAvailable 不为 true 或地址缺失时停止接入',
    '没有可配置的连接时不要保存密钥',
    '工具属于连接 flowlight_skill_2098715147391471616',
    '返回 id 为 2098715147391471616、enabled 为 true',
    '其他 Skill 的同名工具、只列出工具或仅写入配置都不算验证通过',
    '未写入技能时不能报告已安装',
  ]) assert.ok(prompt.includes(expected), expected);
});
