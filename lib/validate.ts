// Out-of-sample check of the valuation mapping on the snapshot's own traded tokens.
//
// The only protocols with an observed market cap are those whose token already trades. For them we
// can ask: knowing TVL, category, 7-day change, listing age and chains, how well does each candidate
// mapping predict log(market cap) for protocols it was NOT fitted on? Folds are fixed by a hash of the
// slug (deterministic, no randomness); every statistic (medians, OLS fit, category offsets) is refitted
// on the training folds only, so no held-out market cap leaks into its own prediction.
//
// The growth / track / breadth factors are fixed heuristics (lib/model.ts), not fitted; adding them to a
// mapping tests whether those fixed adjustments reduce held-out error. The same folds both report the
// errors and pick the mapping, so the selected mapping's error is slightly optimistic: this is model
// selection by cross-validation, not an independent final test.
//
// This validates a cross-sectional proxy on tokens that already launched. It says nothing about launch
// probability, future prices or airdrop rewards, and tokenless protocols may differ systematically.

import { MODEL, calibrate, tokenClass, ageDays, growthFactor, trackFactor, breadthFactor, type ModelConstants, type Snapshot, type SnapshotProtocol } from './model.ts';

export type MappingId = 'global' | 'size' | 'category' | 'category+factors' | 'size+category' | 'size+factors' | 'size+category+factors';
export const MAPPINGS: { id: MappingId; label: string; params: number }[] = [
  { id: 'global', label: 'TVL x one all-category multiple', params: 1 },
  { id: 'size', label: 'Size-aware fit: log mcap = a + b log TVL', params: 2 },
  { id: 'category', label: 'TVL x shrunk category multiple', params: 2 },
  { id: 'category+factors', label: 'Category multiple x growth x track x breadth', params: 3 },
  { id: 'size+category', label: 'Size-aware fit + shrunk category offset', params: 3 },
  { id: 'size+factors', label: 'Size-aware fit x growth x track x breadth', params: 3 },
  { id: 'size+category+factors', label: 'Size-aware fit + category offset x growth x track x breadth', params: 4 },
];
export const FOLDS = 5;

const LN10 = Math.log(10);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
function fold(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 16777619) >>> 0;
  return h % FOLDS;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2) : 0; };

/** Ordinary least squares of y on x; slope shrunk to 1 (a pure multiple) when x has no spread. */
export function ols(x: number[], y: number[]): { a: number; b: number } {
  const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i]! - mx) ** 2; sxy += (x[i]! - mx) * (y[i]! - my); }
  const b = sxx > 0 ? sxy / sxx : 1;
  return { a: my - b * mx, b };
}

export interface SizeFit { a: number; b: number; offsets: Map<string, { offset: number; comps: number }> }

/** The size-aware fit (with shrunk category offsets on its residuals) on a set of traded protocols. */
export function fitSize(train: SnapshotProtocol[], m: ModelConstants = MODEL): SizeFit {
  const x = train.map((p) => Math.log(p.tvl_usd)), y = train.map((p) => Math.log(p.mcap_usd!));
  const { a, b } = ols(x, y);
  const res = new Map<string, number[]>();
  train.forEach((p, i) => { const c = p.category ?? 'Uncategorised'; (res.get(c) ?? res.set(c, []).get(c)!).push(y[i]! - a - b * x[i]!); });
  const offsets = new Map<string, { offset: number; comps: number }>();
  for (const [c, r] of res) offsets.set(c, { offset: (r.length / (r.length + m.shrink_k)) * median(r), comps: r.length });
  return { a, b, offsets };
}

function factorsOf(p: SnapshotProtocol, asOf: string, m: ModelConstants): number {
  return growthFactor(p.change_7d, m) * trackFactor(ageDays(p.listed_at, asOf), m) * breadthFactor(p.chains.length, m);
}

/** One mapping's prediction of ln(market cap) before the related-token and row-class heuristics. The
 *  board (lib/radar.ts) applies the same definition; tests/validate.test.ts checks they agree. */
export function predictLog(id: MappingId, p: SnapshotProtocol, asOf: string, cal: ReturnType<typeof calibrate>, sf: SizeFit, m: ModelConstants = MODEL): number {
  const lt = Math.log(Math.max(1, p.tvl_usd)), c = p.category ?? 'Uncategorised';
  const cm = cal.byCategory.get(c) ?? cal.global;
  const sized = id.startsWith('size'), useCat = id.includes('category'), fx = id.endsWith('+factors');
  const base = sized ? sf.a + sf.b * lt + (useCat ? (sf.offsets.get(c)?.offset ?? 0) : 0) : lt + Math.log(useCat ? cm.multiple : cal.global.multiple);
  return base + (fx ? Math.log(factorsOf(p, asOf, m)) : 0);
}

export interface MappingResult { id: MappingId; label: string; params: number; n: number; mdae_dex: number; mae_dex: number; within_3x: number; folds: number[] }
export interface Validation { comps: number; folds: number; fold_sizes: number[]; results: MappingResult[]; selected: MappingId; best: MappingId; reason: string; full_fit: { a: number; b: number } }

export function validate(snapshot: Snapshot, m: ModelConstants = MODEL, predictions?: Map<string, Record<string, number>>): Validation {
  const comps = snapshot.protocols.filter((p) => tokenClass(p) === 'recorded-trades' && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0);
  const errs = new Map<MappingId, number[]>(MAPPINGS.map((x) => [x.id, []]));
  const foldErr = new Map<MappingId, number[][]>(MAPPINGS.map((x) => [x.id, Array.from({ length: FOLDS }, () => [])]));
  const sizes = Array.from({ length: FOLDS }, () => 0);
  for (let k = 0; k < FOLDS; k++) {
    const test = comps.filter((p) => fold(p.slug) === k), train = comps.filter((p) => fold(p.slug) !== k);
    sizes[k] = test.length;
    if (!test.length || train.length < 3) continue;
    const cal = calibrate({ ...snapshot, protocols: train }, m);
    const sf = fitSize(train, m);
    for (const p of test) {
      const y = Math.log(p.mcap_usd!);
      const pred = (id: MappingId) => predictLog(id, p, snapshot.as_of, cal, sf, m);
      if (predictions) predictions.set(p.slug, Object.fromEntries(MAPPINGS.map((x) => [x.id, pred(x.id)])));
      for (const x of MAPPINGS) { const e = Math.abs(pred(x.id) - y) / LN10; errs.get(x.id)!.push(e); foldErr.get(x.id)![k]!.push(e); }
    }
  }
  const results: MappingResult[] = MAPPINGS.map((x) => {
    const e = errs.get(x.id)!;
    return { ...x, n: e.length, mdae_dex: r3(median(e)), mae_dex: r3(e.reduce((s, v) => s + v, 0) / (e.length || 1)), within_3x: r3(e.filter((v) => v <= Math.log10(3)).length / (e.length || 1)), folds: foldErr.get(x.id)!.map((f) => r3(median(f))) };
  });
  // Select on held-out median error; a more complex mapping must beat the simplest by 0.02 dex (about 5%)
  // to be preferred, otherwise the simpler one is kept.
  const byErr = [...results].sort((a, b) => a.mdae_dex - b.mdae_dex || a.params - b.params);
  const best = byErr[0]!;
  let selected = best;
  for (const r of [...results].sort((a, b) => a.params - b.params || a.mdae_dex - b.mdae_dex)) if (r.mdae_dex <= best.mdae_dex + 0.02) { selected = r; break; }
  const full = comps.length >= 3 ? fitSize(comps, m) : { a: 0, b: 1 };
  return {
    comps: comps.length, folds: FOLDS, fold_sizes: sizes, results, best: best.id, selected: comps.length >= 10 ? selected.id : 'global',
    reason: comps.length < 10 ? 'fewer than 10 traded comparables: kept the all-category multiple' :
      selected.id === best.id ? selected.label + ' had the lowest held-out median error' : selected.label + ' is within 0.02 dex of the best (' + best.label + ') with fewer parameters',
    full_fit: { a: r3(full.a), b: r3(full.b) },
  };
}
