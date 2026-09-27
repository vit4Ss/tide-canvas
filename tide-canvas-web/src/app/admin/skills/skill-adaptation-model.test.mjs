import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as adaptation from '../../../lib/admin-skill-adaptation.ts';
import * as limits from '../../../lib/model-prompt-limit.ts';

const raw = readFileSync(new URL('./_components/skill-manifest-ai-control.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('control.tsx', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const target = new Set(['excerpt', 'parseModelConfig', 'autoConfigurationPrompt']);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && target.has(n.name?.text)).map(n => n.getText(ast)).join('\n');
const context = { ...adaptation, ...limits, SKILL_CATEGORIES: ['专业影视'], HANDLERS: new Set(['text_to_image', 'text_to_video']) };
vm.createContext(context);
vm.runInContext(ts.transpileModule(functions + '\nglobalThis.prompt = autoConfigurationPrompt;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);

test('adaptation prompt keeps end-of-file dependencies instead of silently truncating the Skill', () => {
  const req = { title: 'world', source: 'x'.repeat(24000) + '\nREQUIRES_UNSUPPORTED_WEB_DEPLOY', adaptToPlatform: true };
  const prompt = context.prompt(req, { config: '{}' }, [{ type: 'image', config: '{}', supportedHandlers: ['text_to_image'] }]);
  assert.ok(prompt.includes('REQUIRES_UNSUPPORTED_WEB_DEPLOY'));
  assert.ok(prompt.includes('"adaptation"'));
  assert.ok(prompt.includes('"generationHandlers":["text_to_image"]'));
  assert.ok(prompt.includes('不执行 Bash、Python'));
  assert.throws(() => context.prompt({ ...req, source: 'x'.repeat(120001) }, { config: '{}' }, []), /12 万字/);
});

test('disabling adaptation preserves original manifest-only generation contract', () => {
  const prompt = context.prompt({ title: 'review', source: 'Review only' }, { config: '{}' });
  assert.equal(prompt.includes('"adaptation"'), false);
  assert.equal(prompt.includes('平台适配要求'), false);
});
