// lib/pack.ts: the page data unpacks to exactly what radarData() produced, including awkward strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, UNPACK } from '../lib/pack.ts';
import { parseSnapshot } from '../lib/model.ts';
import { buildBoard, radarData } from '../lib/radar.ts';
import { loadSources } from '../lib/plans.ts';
import { synthSnapshot } from './helpers.ts';

const unpack = (p: unknown) => new Function('return (' + UNPACK + ')(' + JSON.stringify(p) + ')')();

test('round trip on a real board', () => {
  const snap = parseSnapshot(JSON.stringify(synthSnapshot({ n: 700, seed: 1, tokenShare: 0.5 })));
  const book = loadSources();
  const d = JSON.parse(JSON.stringify(radarData(snap, buildBoard(snap, book), book)));
  const p = pack(d);
  assert.deepEqual(unpack(p), d);
  assert.ok(JSON.stringify(p).length < JSON.stringify(d).length * 0.7);
});

test('round trip with names inside other names, nulls, missing keys and marker characters', () => {
  const d = { as_of: 'x', rows: [
    { slug: 'ab', name: 'Ab', note: 'Ab and Abc and ab-c; Ab, again. Ab, again. Ab, again. Ab, again.', category: null, list: ['Ab', 'x'] },
    { slug: 'abc', name: 'Abc', note: 'Ab and Abc and ab-c; Ab, again. Ab, again. Ab, again. Ab, again.', extra: { deep: [1, null, 'Abc'] } },
    { slug: 'q', name: 'Q', note: 'plain' },
  ] };
  assert.deepEqual(unpack(pack(d as never)), d);
  const bad = { rows: [{ slug: 's', name: 'N', t: 'a\u0001b\u0004c' }] };
  assert.deepEqual(unpack(pack(bad as never)).rows[0].t, 'abc');
});
