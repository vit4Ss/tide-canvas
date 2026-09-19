import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const raw = readFileSync(new URL('./clipboard.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function setup({ writeText, throwFallback = false, fallbackResult = true } = {}) {
  const elements = [], attached = new Set(); let fallbackCalls = 0;
  const originalFocus = { isConnected: true, focus() { document.activeElement = originalFocus; } };
  const document = {
    activeElement: originalFocus,
    body: { appendChild(element) { attached.add(element); } },
    createElement() {
      const element = { style: {}, value: '', select() { document.activeElement = element; }, remove() { attached.delete(element); } };
      elements.push(element); return element;
    },
    execCommand() { fallbackCalls++; if (throwFallback) throw new Error('clipboard denied'); return fallbackResult; },
  };
  const context = { exports: {}, document, navigator: writeText ? { clipboard: { writeText } } : {} };
  vm.createContext(context); vm.runInContext(code, context);
  return { copy: context.exports.copyText, document, originalFocus, elements, attached, fallbackCalls: () => fallbackCalls };
}

test('a cancelled sensitive copy does not start any clipboard write', async () => {
  let nativeCalls = 0;
  const env = setup({ writeText: async () => { nativeCalls++; } });
  assert.equal(await env.copy('test-secret', () => false), false);
  assert.equal(nativeCalls, 0); assert.equal(env.fallbackCalls(), 0);
});

test('an asynchronous native rejection cannot fallback after the account changes', async () => {
  let reject, current = true;
  const env = setup({ writeText: () => new Promise((_, no) => { reject = no; }) });
  const copying = env.copy('test-secret', () => current);
  current = false; reject(new Error('denied'));
  assert.equal(await copying, false);
  assert.equal(env.fallbackCalls(), 0); assert.equal(env.attached.size, 0);
});

test('cancelled native completion does not report success or perform another write', async () => {
  let finish, current = true;
  const env = setup({ writeText: () => new Promise(resolve => { finish = resolve; }) });
  const copying = env.copy('test-secret', () => current);
  current = false; finish();
  assert.equal(await copying, false); assert.equal(env.fallbackCalls(), 0);
});

test('fallback always clears and removes the temporary secret and restores focus', async () => {
  for (const options of [{ throwFallback: true }, { fallbackResult: false }, {}]) {
    const env = setup(options);
    assert.equal(await env.copy('test-secret'), !options.throwFallback && options.fallbackResult !== false);
    assert.equal(env.attached.size, 0);
    assert.equal(env.elements[0].value, '');
    assert.equal(env.document.activeElement, env.originalFocus);
  }
});

test('ordinary copies keep native support and HTTP fallback behavior', async () => {
  const writes = [];
  const env = setup({ writeText: async text => { writes.push(text); } });
  assert.equal(await env.copy('ordinary content'), true); assert.deepEqual(writes, ['ordinary content']);
  const fallback = setup({ writeText: async () => { throw new Error('no permission'); } });
  assert.equal(await fallback.copy('ordinary content'), true); assert.equal(fallback.fallbackCalls(), 1);
});

test('using the helper outside a browser remains a non-throwing failure', async () => {
  const context = { exports: {} }; vm.createContext(context); vm.runInContext(code, context);
  assert.equal(await context.exports.copyText('ordinary content'), false);
});
