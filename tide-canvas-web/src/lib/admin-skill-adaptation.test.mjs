import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSkillAdaptation, skillAdaptationCapabilities, SKILL_ADAPTATION_RULES } from './admin-skill-adaptation.ts';

const plan = { steps: [{ handler: 'text_to_image' }, { handler: 'text_to_video' }] };
const draft = () => ({
  status: 'partial', summary: '保留图片视频生成，删除网页部署', instructions: '# 创作\n按本站流程生成图片和视频。不交付网页。',
  replacements: [{ from: '外部图片 API', to: '本站生图', handler: 'text_to_image' }, { from: '外部视频 API', to: '本站生视频', handler: 'text_to_video' }],
  removed: [{ feature: '网页部署', reason: '没有对应执行器' }], limitations: ['不包含无缝拼接'],
});

test('adaptation preserves the native routing map and exposes removed capabilities for review', () => {
  const result = parseSkillAdaptation(draft(), plan);
  assert.equal(result.report.status, 'partial');
  assert.equal(result.report.replacements[1].handler, 'text_to_video');
  assert.equal(result.report.removed[0].feature, '网页部署');
  assert.equal(result.instructions, draft().instructions);
  assert.equal(Object.hasOwn(result.report, 'instructions'), false);
});

test('unsupported and inconsistent adaptations cannot be silently imported', () => {
  for (const change of [
    data => { data.status = 'ready'; },
    data => { data.status = 'blocked'; data.summary = '只剩无法执行的本地构建'; },
    data => { data.replacements[0].handler = 'run_shell'; },
    data => { data.instructions = '{{skill.file:old-script.md}}'; },
    data => { data.replacements[0].apiKey = 'placeholder'; },
    data => { data.removed = []; data.limitations = []; },
    data => { data.instructions = 'x'.repeat(32001); },
    data => { data.sourceUrl = 'https://unrequested.example/'; },
  ]) { const data = draft(); change(data); assert.throws(() => parseSkillAdaptation(data, plan)); }
  assert.throws(() => parseSkillAdaptation(draft(), { steps: [{ handler: 'text_to_image' }] }), /text_to_video/);
});

test('compatible pure instructions remain a valid adaptation without artificial paid generation', () => {
  const result = parseSkillAdaptation({ status: 'ready', summary: '保留文本审查', instructions: '# 审查\n检查用户提供的文本。', replacements: [], removed: [], limitations: [] }, {});
  assert.equal(result.report.replacements.length, 0);
});

test('capability prompt only advertises available native generation handlers without keys or model IDs', () => {
  const result = JSON.parse(skillAdaptationCapabilities([
    { type: 'image', modelId: 'secret-route', config: '{}', supportedHandlers: ['text_to_image'] },
    { type: 'video', modelId: 'maintenance', config: '{"availabilityStatus":"maintenance"}' },
    { type: 'text', modelId: 'text', config: '{}' },
  ]));
  assert.deepEqual(result.generationHandlers, ['text_to_image']);
  assert.equal(JSON.stringify(result).includes('secret-route'), false);
  assert.ok(SKILL_ADAPTATION_RULES.includes('{{previous}} 只能作为文本提示'));
});
