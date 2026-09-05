import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { buildAccountSnapshot } from './account-insights.ts';
import { CONTENT_REPORT_FORMAT } from './content-report.ts';

// Execute the actual private prompt builders without importing the browser UI.
const source = readFileSync(new URL('./analysis-workbench.tsx', import.meta.url), 'utf8');
const defaults = source.slice(source.indexOf('const DEFAULT_FOCUS ='), source.indexOf('const DOWNLOAD_QUALITY_LABEL:'));
const builders = source.slice(source.indexOf('function byteLength('), source.indexOf('function analysisRunContext('));
const context = vm.createContext({ buildAccountSnapshot, CONTENT_REPORT_FORMAT, TextEncoder });
vm.runInContext(ts.transpileModule(`${defaults}\n${builders}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);

function dataFrom(prompt) {
  return JSON.parse(prompt.split('<platform_data untrusted="true">\n')[1].split('\n</platform_data>')[0]);
}

const richDetails = {
  fields: Array.from({ length: 12 }, (_, i) => ({ key: `field${i}`, label: '公开资料', value: '文'.repeat(600) })),
  tags: Array.from({ length: 40 }, (_, i) => `${i}${'标'.repeat(120)}`),
  chapters: Array.from({ length: 100 }, (_, i) => ({ title: '章'.repeat(200), start: i * 20 })),
  languages: ['zh-CN', 'en'],
};
const work = { id: 'video1', title: '题'.repeat(300), description: '文'.repeat(4000), mediaType: 'video', stats: { play: '100', like: '0', coin: '5' }, details: richDetails };
const result = {
  platform: 'bilibili', platformName: '哔哩哔哩', sourceUrl: `https://example.com/video?token=${'a'.repeat(4000)}`,
  profile: { name: '作者', bio: '简'.repeat(2000), followers: '1000', details: richDetails },
  works: Array.from({ length: 12 }, (_, i) => ({ ...work, id: `video${i}` })),
};

test('rich native metadata never exceeds the skill prompt byte limit', () => {
  for (const prompt of [context.accountPrompt(result, '问'.repeat(4000)), context.contentPrompt(result, work, '问'.repeat(4000), true)]) {
    assert.ok(Buffer.byteLength(prompt) <= 30 * 1024, `prompt is ${Buffer.byteLength(prompt)} bytes`);
    assert.ok(dataFrom(prompt));
    assert.ok(!prompt.includes('\uFFFD'));
  }
});

test('prompt budgeting keeps all sample statistics and does not mutate the snapshot', () => {
  const before = JSON.stringify(result);
  const data = dataFrom(context.accountPrompt(result, '分析账号'));
  assert.equal(data.recentWorks.length, 12);
  assert.equal(data.recentWorks[0].stats.coin, '5');
  assert.equal(data.recentWorks[0].stats.like, '0');
  assert.equal(JSON.stringify(result), before);
});
