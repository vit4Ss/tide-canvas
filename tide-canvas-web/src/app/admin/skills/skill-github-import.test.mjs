import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { checkedSkillFileMetadata } from '../../../lib/admin-skill-package.ts';

const raw = readFileSync(new URL('./_components/skill-import-modal.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('modal.tsx', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ['truncateRunes', 'prepareGitHubPackages'].map(name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `${name} is present`);
  return node.getText(ast);
}).join('\n');
let readSourceCode;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'readSource') readSourceCode = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(readSourceCode);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const content = '---\nname: review\ndescription: Review videos\n---\n# Review';
const preview = {
  sourceUrl: 'https://github.com/team/repo/tree/' + 'a'.repeat(40),
  commitSha: 'a'.repeat(40), directory: '', ignoredFiles: 2,
  packages: [{ root: 'review', primaryFilePath: 'SKILL.md', files: [{ path: 'SKILL.md', content }] }],
};
const metadata = count => ({ success: true, data: { valid: true, items: Array.from({ length: count }, (_, index) => ({
  index, valid: true, errors: [], name: `review-${index}`, description: 'Review videos',
})) } });

function prepareEnvironment(response = { success: true, data: preview }, validation) {
  const calls = [];
  const ctx = vm.createContext({ MAX_PACKAGES: 50, checkedSkillFileMetadata,
    adminSkillsApi: {
      previewGitHub: async (url, signal) => { calls.push({ url, signal }); return response; },
      validateFiles: async (packages, signal) => { calls.push({ packages, signal }); return validation ?? metadata(packages.length); },
    },
  });
  vm.runInContext(compile(functions + '\nglobalThis.prepare = prepareGitHubPackages;'), ctx);
  return { calls, prepare: ctx.prepare };
}

test('GitHub packages use server format validation and retain the exact pinned content', async () => {
  const env = prepareEnvironment(); const signal = new AbortController().signal;
  const result = await env.prepare(' https://github.com/team/repo ', signal);
  assert.equal(env.calls[0].url, 'https://github.com/team/repo');
  assert.equal(env.calls[1].signal, signal);
  assert.equal(result[0].title, 'review-0');
  assert.equal(result[0].files[0].content, content);
  assert.equal(result[0].ignoredFiles, 2);
  assert.equal(result[0].commitSha, preview.commitSha);
  assert.equal(result[0].sourceUrl, preview.sourceUrl);
});

test('GitHub failures and invalid packages cannot start AI import', async () => {
  const signal = new AbortController().signal;
  for (const response of [
    { success: false, message: 'GitHub 请求额度已用完' },
    { success: true, data: { ...preview, packages: [] } },
    { success: true, data: { ...preview, commitSha: 'main' } },
    { success: true, data: { ...preview, sourceUrl: 'javascript:alert(1)' } },
  ]) {
    const env = prepareEnvironment(response);
    await assert.rejects(env.prepare('https://github.com/team/repo', signal));
    assert.equal(env.calls.length, 1);
  }
  const env = prepareEnvironment(undefined, { success: true, data: { valid: false, items: [{ index: 0, valid: false, errors: ['name 与目录不一致'] }] } });
  await assert.rejects(env.prepare('https://github.com/team/repo', signal), /name 与目录不一致/);
});

test('canceled GitHub read does not continue validation', async () => {
  const controller = new AbortController(); controller.abort();
  const env = prepareEnvironment();
  await assert.rejects(env.prepare('https://github.com/team/repo', controller.signal), /取消/);
  assert.equal(env.calls.length, 1);
});

function readEnvironment() {
  const state = { packages: [], reading: false, validation: null, fileError: '', autoStartToken: 0 };
  const toasts = [];
  const ctx = { AbortController, Promise, Error, setTimeout, clearTimeout,
    submitting: false, manifestBusy: false, validationPendingRef: { current: false }, readSeqRef: { current: 0 }, readControllerRef: { current: null },
    SKILL_CATEGORIES: ['test'], defaultAdminSkillEntryPoints: () => ['canvas'],
    toast: { error: text => toasts.push(text) },
  };
  for (const key of ['Packages', 'Reading', 'Validation', 'FileError', 'AutoStartToken', 'Kind', 'InputPreset', 'PrimaryOutputType', 'Category', 'AuthorName', 'McpEnabled', 'EntryPoints']) {
    const property = key[0].toLowerCase() + key.slice(1);
    ctx[`set${key}`] = value => { state[property] = typeof value === 'function' ? value(state[property]) : value; };
  }
  vm.createContext(ctx); vm.runInContext(compile('globalThis.read = ' + readSourceCode), ctx);
  return { ctx, state, toasts, read: ctx.read };
}

test('rapid repeated reads do not duplicate requests and never inherit old runtime configuration', async () => {
  const env = readEnvironment(); let resolve, calls = 0;
  const pending = new Promise(r => { resolve = r; });
  const first = env.read(() => { calls++; return pending; });
  await env.read(() => { calls++; return Promise.resolve([]); });
  assert.equal(calls, 1);
  resolve([{ key: 'github:review' }]); await first;
  assert.equal(env.state.autoStartToken, 1);
  assert.equal(env.state.mcpEnabled, false);
  assert.equal(env.state.kind, 'agent');
  assert.equal(env.state.reading, false);
  assert.equal(env.ctx.validationPendingRef.current, false);
});

test('closing the modal cancels remote reading and discards late packages', async () => {
  const env = readEnvironment(); let resolve;
  const pending = new Promise(r => { resolve = r; });
  const reading = env.read(() => pending);
  env.ctx.readSeqRef.current++;
  env.ctx.readControllerRef.current.abort();
  await reading;
  resolve([{ key: 'late' }]); await Promise.resolve();
  assert.equal(env.state.packages.length, 0);
  assert.equal(env.state.autoStartToken, 0);
  assert.equal(env.toasts.length, 0);
});

test('read failure unlocks the form and cannot expose a stale import package', async () => {
  const env = readEnvironment();
  await env.read(async () => { throw new Error('GitHub 读取超时'); });
  assert.equal(env.state.reading, false);
  assert.equal(env.ctx.validationPendingRef.current, false);
  assert.equal(env.state.packages.length, 0);
  assert.equal(env.state.autoStartToken, 0);
  assert.equal(env.state.fileError, 'GitHub 读取超时');
});
