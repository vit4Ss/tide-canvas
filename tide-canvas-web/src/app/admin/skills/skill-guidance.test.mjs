import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const raw = readFileSync(new URL('./_components/skill-copy-ai-button.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('copy.tsx', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['parseJSONText', 'limitedText', 'parseGeneratedSkillCopy']);
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text)).map(n => n.getText(source).replace(/^export /, '')).join('\n');
const context = {}; vm.createContext(context); vm.runInContext(ts.transpileModule(functions + '\nglobalThis.parse = parseGeneratedSkillCopy;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const base = { description: '介绍', usageScenario: '适用场景', howTo: '使用步骤', outputDescription: '结果说明' };

test('AI guidance keeps existing four-field responses compatible', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.parse(JSON.stringify(base)))), base);
});

test('AI guidance retains input/output examples and bounds their displayed lengths', () => {
  const result = context.parse(JSON.stringify({ ...base, inputDescription: ' 提供视频 ', inputExample: '😀'.repeat(4100), outputExample: '结果'.repeat(3100) }));
  assert.equal(result.inputDescription, '提供视频');
  assert.equal(Array.from(result.inputExample).length, 4000);
  assert.equal(Array.from(result.outputExample).length, 6000);
});

test('AI guidance does not turn structured or missing fields into fake public examples', () => {
  const result = context.parse(JSON.stringify({ ...base, inputExample: { secret: 'private' }, outputExample: null }));
  assert.equal(result.inputExample, undefined); assert.equal(result.outputExample, undefined);
  assert.equal(context.parse('{"inputExample":"only example"}'), null);
});
