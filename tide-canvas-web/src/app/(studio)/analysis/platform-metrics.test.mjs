import assert from 'node:assert/strict';
import test from 'node:test';
import { platformMetrics, platformVocabulary } from './platform-metrics.js';
import { buildWorkSnapshot } from './work-insights.ts';
import { buildAccountSnapshot, buildAccountFeatures } from './account-insights.ts';

test('platform metrics have distinct definitions and content vocabulary', () => {
  assert.deepEqual(platformMetrics('youtube').map(x => x.key), ['play', 'like', 'comment']);
  assert.ok(platformMetrics('bilibili').some(x => x.key === 'coin'));
  assert.ok(!platformMetrics('xiaohongshu').some(x => x.key === 'danmaku'));
  assert.equal(platformVocabulary('youtube').followers, '订阅者');
  assert.equal(platformVocabulary('xiaohongshu').works, '笔记');
});

test('Bilibili visible interactions include coins and danmaku, zero stays measured', () => {
  const work = { platform: 'bilibili', stats: { play: '100', like: '10', coin: '5', danmaku: '0' } };
  const snap = buildWorkSnapshot(work);
  assert.equal(snap.interactions, 15);
  assert.equal(snap.engagementRate, 15);
  assert.equal(snap.measuredFields, 3);
  const account = buildAccountSnapshot({ platform: 'bilibili', works: [work] });
  assert.equal(account.totalInteractions, 15);
  assert.equal(account.interactionParts.find(x => x.key === 'coin').value, 5);
});

test('downloads do not inflate engagement, image notes do not invent view rates', () => {
  const short = buildWorkSnapshot({ platform: 'douyin', stats: { play: '100', like: '2', download: '90' } });
  assert.equal(short.engagementRate, 2);
  const note = buildWorkSnapshot({ platform: 'xiaohongshu', mediaType: 'image', stats: { like: '100', favorite: '50' } });
  assert.equal(note.interactions, 150);
  assert.equal(note.views, null);
  assert.equal(note.engagementRate, null);
});

test('YouTube coverage is complete with its two public interaction counters', () => {
  const result = buildAccountSnapshot({ platform: 'youtube', works: [{ stats: { play: '100', like: '0', comment: '0' } }] });
  assert.equal(buildAccountFeatures(result).completeInteractionSamples, 1);
  assert.equal(result.engagementRate, 0);
});
