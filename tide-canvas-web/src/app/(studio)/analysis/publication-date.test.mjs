import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublicationDate } from './publication-date.js';

test('compact and ISO calendar dates agree and do not invent a time', () => {
  for (const value of ['20260905', '2026-09-05', ' 20260905 ']) {
    assert.deepEqual(parsePublicationDate(value), { timestamp: Date.UTC(2026, 8, 5), hasTime: false });
  }
  assert.equal(parsePublicationDate('20240229')?.timestamp, Date.UTC(2024, 1, 29));
});

test('seconds, milliseconds and explicit time zones preserve the same instant', () => {
  const timestamp = Date.parse('2026-09-05T08:12:34Z');
  for (const value of [String(timestamp / 1000), String(timestamp), '2026-09-05T08:12:34Z', '2026-09-05T16:12:34+08:00']) {
    assert.deepEqual(parsePublicationDate(value), { timestamp, hasTime: true });
  }
});

test('invalid or absent dates cannot create chart points or publication hours', () => {
  for (const value of [undefined, '', '0', '0000000000', '-1', '20260230', '20261301', '2026-02-29', '2026-02-30T12:00:00Z', '2026-09-05T24:00:00Z', '2026-09-05T12:60:00Z', '3 days ago', 'Infinity']) {
    assert.equal(parsePublicationDate(value), null, value);
  }
});
