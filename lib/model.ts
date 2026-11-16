// Token Radar model: one snapshot of the protocol universe in, one ranked board out.
//
// Adapted from the make.fun token-radar-01 starter (MIT, (c) 2026 the make.fun team): the snapshot
// parser shape and the gate checks follow it; the value model, token classes, risk, effort and cost
// models below are this entry's own.
//
// Every number comes from the snapshot's own figures. No protocol name is special-cased: the same
// functions score every row, so a different snapshot produces a different board.
//
// Implied launch value (what a token would be worth if the record stayed as it is). lib/validate.ts
// scores five TVL-to-value mappings on held-out traded tokens and the board uses the one selected there
// (practice snapshot: the size-aware fit base = exp(a + b ln TVL)). The multiple mappings are:
//
//   multiple_c = the category's market-cap / TVL ratio, measured on this snapshot's protocols whose
//                token trades (median of log ratios), shrunk toward the all-category median by
//                n / (n + SHRINK_K); the all-category median is itself shrunk toward PRIOR_MULTIPLE
//   growth     = 1 + GROWTH_WEIGHT x clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) / 100   (null: 1)
//   track      = 0.70 + 0.30 x min(age, 730) / 730, then x fade past 1095 days tokenless (min 0.85)
//                (age unknown: TRACK_UNKNOWN)
//   breadth    = 1 + 0.04 x min(chains - 1, 5)
//   sibling    = SIBLING_FACTOR when a token-bearing protocol shares the name's first word, else 1
//   implied    = round(tvl x multiple_c x growth x track x breadth x sibling)
//
// The range is implied x exp(+/- spread_c), spread_c being half the category's shrunk log IQR,
// widened when the 7-day change or the listing date is missing.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL = {
  version: 'radar-calibrated-2',
  prior_multiple: 0.25,
  shrink_k: 5,
  min_multiple: 0.03,
  max_multiple: 1.5,
  growth_weight: 0.6,
  growth_floor: -40,
  growth_cap: 60,
  track_base: 0.7,
  track_span: 0.3,
  track_full_days: 730,
  fade_after_days: 1095,
  fade_floor: 0.85,
  track_unknown: 0.85,
  breadth_step: 0.04,
  breadth_max_extra_chains: 5,
  sibling_factor: 0.6,
  default_spread: 0.9,
  missing_widen: 0.15,
  max_rows: 4000,
  min_rows: 100,
};
export type ModelConstants = typeof MODEL;

/** Categories that the house rule (and this model) treats as products of something else, not launch candidates. */
export const SET_ASIDE_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it has the documented shape. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  const watch = Array.isArray(o.watchlist) ? o.watchlist.filter((s): s is string => typeof s === 'string') : [];
  const seen = new Set<string>();
  const protocols: SnapshotProtocol[] = [];
  o.protocols.forEach((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError('protocol ' + i + ' is not an object');
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || !p.slug || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError('protocol ' + i + ' lacks a slug, a name or a TVL');
    }
    if (seen.has(p.slug)) return;
    seen.add(p.slug);
    const str = (x: unknown) => (typeof x === 'string' && x !== '' && x !== '-' ? x : null);
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    protocols.push({
      slug: p.slug,
      name: p.name.trim() || p.slug,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string' && c !== '') : [],
      tvl_usd: Math.max(0, Math.trunc(p.tvl_usd)),
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: typeof p.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.listed_at) ? p.listed_at.slice(0, 10) : null,
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    });
  });
  protocols.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return {
    as_of: o.as_of,
    source: typeof o.source === 'string' ? o.source : 'unknown source',
    floor_usd: typeof o.floor_usd === 'number' && o.floor_usd > 0 ? o.floor_usd : 50_000_000,
    protocols,
    watchlist: watch.filter((s) => seen.has(s)),
  };
}

// ---------------------------------------------------------------- token status

export type TokenClass = 'none-recorded' | 'recorded-trades' | 'recorded-unpriced';

/** What DefiLlama's record says about a token. "none-recorded" is never "has no token". */
export function tokenClass(p: SnapshotProtocol): TokenClass {
  if (p.gecko_id === null && p.symbol === null) return p.mcap_usd !== null && p.mcap_usd > 0 ? 'recorded-trades' : 'none-recorded';
  return p.mcap_usd !== null && p.mcap_usd > 0 ? 'recorded-trades' : 'recorded-unpriced';
}

/** Why a no-token protocol is set aside as a product of something else, or null when it is a launch candidate. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SET_ASIDE_CATEGORIES.includes(p.category)) return 'category ' + p.category + ' (a bridge, exchange or staking product, usually of a token that trades)';
  if (VERSIONED.test(p.name)) return 'versioned name (a later version of an existing protocol)';
  if (WRAPPED_WORD.test(p.name)) return 'name says wrapped / staked / staking';
  const ex = EXCHANGES.find((e) => p.name.startsWith(e));
  if (ex) return 'begins with exchange name ' + ex;
  return null;
}

function firstWord(name: string): string {
  return name.toLowerCase().split(/[\s\-_.:()]+/)[0] ?? '';
}

/** Token-bearing protocols that share this name's first word: a possible parent or sibling token. */
export function siblingIndex(protocols: SnapshotProtocol[]): Map<string, string[]> {
  const byWord = new Map<string, string[]>();
  for (const p of protocols) {
    if (tokenClass(p) === 'none-recorded') continue;
    const w = firstWord(p.name);
    if (w.length < 4) continue;
    const label = p.name + (p.symbol ? ' (' + p.symbol + ')' : '');
    const list = byWord.get(w) ?? [];
    if (!list.includes(label)) list.push(label);
    byWord.set(w, list);
  }
  return byWord;
}

// ---------------------------------------------------------------- calibration

export interface CategoryMultiple {
  category: string;
  comps: number;
  raw_median: number | null;
  multiple: number;
  spread: number;
  examples: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r4 = (x: number) => Math.round(x * 10000) / 10000;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Market cap / TVL by category, measured on the snapshot's own token-trading protocols. */
export function calibrate(snapshot: Snapshot, m: ModelConstants = MODEL): { global: CategoryMultiple; byCategory: Map<string, CategoryMultiple> } {
  const comps = snapshot.protocols.filter((p) => tokenClass(p) === 'recorded-trades' && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0);
  const logOf = (p: SnapshotProtocol) => Math.log(clamp((p.mcap_usd as number) / p.tvl_usd, 0.01, 20));
  const all = comps.map(logOf).sort((a, b) => a - b);
  const prior = Math.log(m.prior_multiple);
  const wg = all.length / (all.length + 10);
  const gMed = all.length ? wg * quantile(all, 0.5) + (1 - wg) * prior : prior;
  const gSpread = all.length >= 4 ? (quantile(all, 0.75) - quantile(all, 0.25)) / 2 : m.default_spread;
  const global: CategoryMultiple = {
    category: 'All categories',
    comps: all.length,
    raw_median: all.length ? r4(Math.exp(quantile(all, 0.5))) : null,
    multiple: r4(clamp(Math.exp(gMed), m.min_multiple, m.max_multiple)),
    spread: r4(clamp(gSpread, 0.3, 1.6)),
    examples: [],
  };
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of comps) {
    const c = p.category ?? 'Uncategorised';
    const g = groups.get(c) ?? [];
    g.push(p);
    groups.set(c, g);
  }
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [c, ps] of groups) {
    const logs = ps.map(logOf).sort((a, b) => a - b);
    const w = logs.length / (logs.length + m.shrink_k);
    const med = w * quantile(logs, 0.5) + (1 - w) * gMed;
    const iqr = logs.length >= 3 ? (quantile(logs, 0.75) - quantile(logs, 0.25)) / 2 : gSpread;
    byCategory.set(c, {
      category: c,
      comps: logs.length,
      raw_median: r4(Math.exp(quantile(logs, 0.5))),
      multiple: r4(clamp(Math.exp(med), m.min_multiple, m.max_multiple)),
      spread: r4(clamp(w * iqr + (1 - w) * gSpread, 0.3, 1.6)),
      examples: [...ps].sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0)).slice(0, 3).map((p) => p.name + (p.symbol ? ' (' + p.symbol + ')' : '')),
    });
  }
  return { global, byCategory };
}

// ---------------------------------------------------------------- value

export function ageDays(listed: string | null, asOf: string): number | null {
  if (!listed) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listed + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

export function growthFactor(c7: number | null, m: ModelConstants = MODEL): number {
  if (c7 === null) return 1;
  return r4(1 + (m.growth_weight * clamp(c7, m.growth_floor, m.growth_cap)) / 100);
}

export function trackFactor(age: number | null, m: ModelConstants = MODEL): number {
  if (age === null) return m.track_unknown;
  let f = m.track_base + (m.track_span * Math.min(age, m.track_full_days)) / m.track_full_days;
  if (age > m.fade_after_days) f *= Math.max(m.fade_floor, 1 - ((1 - m.fade_floor) * (age - m.fade_after_days)) / m.fade_after_days);
  return r4(f);
}

export function breadthFactor(chains: number, m: ModelConstants = MODEL): number {
  return r4(1 + m.breadth_step * clamp(chains - 1, 0, m.breadth_max_extra_chains));
}

export interface ValueParts {
  /** Which mapping turns TVL into a base value; chosen per snapshot by held-out error (lib/validate.ts). */
  mapping: 'global' | 'size' | 'category' | 'category+factors' | 'size+category' | 'size+factors' | 'size+category+factors';
  /** Size-aware fit: base = exp(a + b ln TVL + offset). Unused (0, 1, 0) for multiple mappings. */
  a: number;
  b: number;
  offset: number;
  /** base / TVL: the multiple actually applied (fitted for multiple mappings, effective for the size fit). */
  multiple: number;
  comps: number;
  growth: number;
  track: number;
  breadth: number;
  sibling: number;
  cls: number;
  spread: number;
}

export const SIZE_MAPPINGS = ['size', 'size+category', 'size+factors', 'size+category+factors'];

/** Base value from TVL alone under the selected mapping. */
export function baseValue(tvl: number, v: Pick<ValueParts, 'mapping' | 'a' | 'b' | 'offset' | 'multiple'>): number {
  return SIZE_MAPPINGS.includes(v.mapping) ? Math.exp(v.a + v.b * Math.log(Math.max(1, tvl)) + v.offset) : tvl * v.multiple;
}

export function impliedValue(tvl: number, v: ValueParts): number {
  return Math.max(1, Math.round(baseValue(tvl, v) * v.growth * v.track * v.breadth * v.sibling * v.cls));
}
