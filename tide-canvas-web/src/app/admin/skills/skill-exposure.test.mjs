import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual editor serializer: an unrelated edit in an older tab
// must not turn a Skill back on after another admin has disabled it.
const raw = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('page.tsx', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'buildDTO') callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const code = ts.transpileModule('globalThis.build = ' + callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function serialize(previous, current, creating = false) {
  const form = {
    title: 'New display title', description: 'Review videos', coverUrl: '', category: '专业影视',
    outputType: 'text', promptTemplate: 'Private instructions', usageScenario: 'Video review',
    usageGuide: 'Provide a video', outputDescription: 'A review', modelId: '', defaultParams: '{}',
    inputDescription: 'Input guidance', inputExample: 'Example request', outputExample: 'Example result',
    authorName: '官方', status: 1, sortOrder: '0', entryPoints: ['canvas'], mcpEnabled: current,
  };
  const context = {
    form, editing: creating ? null : { ...form, title: 'Original title', mcpEnabled: previous },
    editingVersionedSkill: !creating, contentAccess: 'editable',
    utf8ByteLength: value => Buffer.byteLength(value), MAX_OPERATOR_SKILL_DOCUMENT_BYTES: 512 * 1024,
    toast: { info: assert.fail, error: assert.fail },
  };
  vm.createContext(context); vm.runInContext(code, context);
  return JSON.parse(JSON.stringify(context.build().dto));
}

test('metadata edits omit unchanged exposure, preserving changes by another administrator', () => {
  for (const previous of [false, true, undefined]) {
    const dto = serialize(previous, previous === true);
    assert.equal(Object.hasOwn(dto, 'mcpEnabled'), false);
    assert.equal(dto.title, 'New display title');
    assert.equal(dto.status, 1);
    assert.equal(dto.inputDescription, 'Input guidance');
    assert.equal(dto.inputExample, 'Example request');
    assert.equal(dto.outputExample, 'Example result');
  }
});

test('explicit enable and disable are still sent with the editor save', () => {
  assert.equal(serialize(false, true).mcpEnabled, true);
  assert.equal(serialize(true, false).mcpEnabled, false);
});

test('new skills explicitly keep exposure off unless selected', () => {
  assert.equal(serialize(undefined, false, true).mcpEnabled, false);
  assert.equal(serialize(undefined, true, true).mcpEnabled, true);
});
