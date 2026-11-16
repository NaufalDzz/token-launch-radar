// The valuation check: deterministic, leak-free folds, and the board's values follow the validated definitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL, calibrate, parseSnapshot, tokenClass } from '../lib/model.ts';
import { MAPPINGS, fitSize, predictLog, validate, type MappingId } from '../lib/validate.ts';
import { buildBoard } from '../lib/radar.ts';
import { synthSnapshot } from './helpers.ts';

const snap = parseSnapshot(JSON.stringify(synthSnapshot({ n: 700, seed: 1, tokenShare: 0.5 })));

test('validation is deterministic and scores every mapping on every traded token', () => {
  const a = validate(snap), b = validate(snap);
  assert.deepEqual(a, b);
  const traded = snap.protocols.filter((p) => tokenClass(p) === 'recorded-trades' && p.tvl_usd > 0).length;
  assert.equal(a.comps, traded);
  assert.equal(a.fold_sizes.reduce((s, n) => s + n, 0), traded);
  assert.equal(a.results.length, MAPPINGS.length);
  for (const r of a.results) assert.equal(r.n, traded);
  const sel = a.results.find((r) => r.id === a.selected)!;
  const best = a.results.find((r) => r.id === a.best)!;
  assert.ok(sel.mdae_dex <= best.mdae_dex + 0.02 && sel.params <= best.params);
});

test('a held-out prediction does not see its own market cap', () => {
  const before = new Map<string, Record<string, number>>(), after = new Map<string, Record<string, number>>();
  validate(snap, MODEL, before);
  const target = snap.protocols.find((p) => tokenClass(p) === 'recorded-trades')!;
  validate({ ...snap, protocols: snap.protocols.map((p) => (p === target ? { ...p, mcap_usd: p.mcap_usd! * 1000 } : p)) }, MODEL, after);
  assert.deepEqual(after.get(target.slug), before.get(target.slug));
});

test('each mapping on the board reproduces its validated prediction (offsets and factors included)', () => {
  const traded = snap.protocols.filter((p) => tokenClass(p) === 'recorded-trades' && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0);
  const cal = calibrate(snap), sf = fitSize(traded);
  for (const { id } of MAPPINGS) {
    const forced = { ...snap };
    const built = buildBoard(forced, null, MODEL, id as MappingId);
    assert.ok(built.rows.every((r) => r.model.mapping === id));
    const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
    for (const r of built.rows.slice(0, 60)) {
      const want = Math.exp(predictLog(id as MappingId, bySlug.get(r.slug)!, snap.as_of, cal, sf)) * r.model.sibling * r.model.cls;
      assert.ok(Math.abs(Math.log(r.implied_value_usd / want)) < 0.002, id + ' ' + r.slug + ': ' + r.implied_value_usd + ' vs ' + want);
    }
  }
});
