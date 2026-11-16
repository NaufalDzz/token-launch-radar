// Assemble the board, the dashboard data and the gate check from a parsed snapshot.

import {
  baseValue,
  SIZE_MAPPINGS,
  MODEL, ageDays, breadthFactor, calibrate, growthFactor, impliedValue, setAsideReason, siblingIndex, tokenClass, trackFactor,
  type CategoryMultiple, type ModelConstants, type Snapshot, type SnapshotProtocol, type ValueParts,
} from './model.ts';
import { fitSize, validate, type MappingId } from './validate.ts';

const r4 = (x: number) => Math.round(x * 10000) / 10000;
import { costOf, effortOf, farmPlan, playbookFor, researchPlan, riskOf, stepString, type Facts, type Plan, type SourceBook } from './plans.ts';

/**
 * Why a row is on the board.
 *   candidate        DefiLlama records no token, and no set-aside rule applies: the radar's real subject.
 *   watchlist        a house-watchlist slug with no token recorded (always shown: the gate covers the watchlist).
 *   watchlist-token  a watchlist slug whose record does carry a token: shown for coverage, flagged, never a candidate.
 *   weak-candidate   no token recorded, but a set-aside rule applies (bridge, exchange, staking, versioned or
 *                    wrapped name); used only when a snapshot has under 100 candidates, discounted and labelled.
 * A protocol whose token already trades or is recorded is never added to reach a row count: when the snapshot
 * cannot fill 100 rows without one, buildBoard throws BoardShortfall and the build fails, saying why.
 */
export type RowClass = 'watchlist' | 'candidate' | 'watchlist-token' | 'weak-candidate';
const CLASS_FACTOR: Record<RowClass, number> = { watchlist: 1, candidate: 1, 'watchlist-token': 1, 'weak-candidate': 0.3 };

export class BoardShortfall extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardShortfall';
  }
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: string;
  row_class: RowClass;
  classification: { certainty: 'clear' | 'uncertain' | 'weak'; reason: string };
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_range_usd: [number, number];
  confidence: 'Low' | 'Medium' | 'High';
  model: ValueParts & { category_basis: string };
  opportunity: number;
  risk: ReturnType<typeof riskOf>;
  effort: ReturnType<typeof effortOf>;
  cost: ReturnType<typeof costOf>;
  playbook: string;
  signals: string[];
  flags: string[];
  farm_steps: string[];
  research: string[];
  plan_basis: Plan['basis'];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function signalsOf(p: SnapshotProtocol, age: number | null): string[] {
  const s: string[] = [];
  if (age !== null && age <= 180) s.push(p.change_7d !== null && p.change_7d > 0 ? 'New and growing' : 'New listing');
  if (p.change_7d !== null && p.change_7d >= 10) s.push('Strong inflow');
  if (p.change_7d !== null && p.change_7d <= -15) s.push('Outflow');
  if (age !== null && age > 1095) s.push('Long tokenless');
  return s;
}

/** Why a row's token status reads as it does, and how sure the record lets us be. */
function classify(p: SnapshotProtocol, cls: RowClass, siblings: string[]): BoardRow['classification'] {
  if (cls === 'watchlist-token') return { certainty: 'weak', reason: 'DefiLlama records ' + (p.symbol ? 'ticker ' + p.symbol : 'CoinGecko id ' + p.gecko_id) + (p.mcap_usd ? ' with a market cap' : ' without a market cap') + '; listed only because the watchlist names it.' };
  if (cls === 'weak-candidate') return { certainty: 'weak', reason: 'No token recorded, but ' + setAsideReason(p) + '; such products usually belong to a protocol whose token trades.' };
  const base = 'No CoinGecko id, ticker or market cap recorded; category ' + (p.category ?? 'missing') + ' is not a set-aside class and the name is not versioned or wrapped.';
  if (siblings.length) return { certainty: 'uncertain', reason: base + ' But ' + siblings.slice(0, 2).join(', ') + ' shares its first name word and records a token, so a parent token may cover it.' };
  if (p.category === null) return { certainty: 'uncertain', reason: base + ' With no category, the product type is a guess.' };
  return { certainty: 'clear', reason: base };
}

export function buildBoard(snapshot: Snapshot, book: SourceBook | null = null, m: ModelConstants = MODEL, force?: MappingId) {
  const cal = calibrate(snapshot, m);
  const validation = validate(snapshot, m);
  const mapping = force ?? validation.selected;
  const traded = snapshot.protocols.filter((p) => tokenClass(p) === 'recorded-trades' && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0);
  const fit = fitSize(traded.length >= 3 ? traded : [], m);
  const sel = validation.results.find((r) => r.id === mapping)!;
  // The value range: x/÷ the selected mapping's held-out median error (about half of held-out tokens fall inside).
  const heldSpread = sel.n ? Math.min(2.3, Math.max(0.3, sel.mdae_dex * Math.LN10)) : m.default_spread;
  const sized = SIZE_MAPPINGS.includes(mapping), useCat = mapping.includes('category'), factors = mapping.endsWith('+factors');
  const sib = siblingIndex(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const candidates: [SnapshotProtocol, RowClass][] = [];
  const setAside: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[] = [];
  const unpriced: SnapshotProtocol[] = [];
  const live: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    const tc = tokenClass(p);
    if (watch.has(p.slug)) { candidates.push([p, tc === 'none-recorded' ? 'watchlist' : 'watchlist-token']); continue; }
    if (tc === 'recorded-trades') { live.push(p); continue; }
    if (tc === 'recorded-unpriced') { unpriced.push(p); continue; }
    const why = setAsideReason(p);
    if (why) setAside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: why });
    else candidates.push([p, 'candidate']);
  }
  const byTvl = <T extends { tvl_usd: number; slug: string }>(a: T, b: T) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1);
  setAside.sort(byTvl);
  unpriced.sort(byTvl);
  // Under 100 candidates: add set-aside rows (still no token recorded), largest first, labelled and discounted.
  // Never a row whose record carries a token: if that is not enough, fail and say so.
  if (candidates.length < m.min_rows) {
    const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    for (const s of setAside) {
      if (candidates.length >= m.min_rows) break;
      candidates.push([index.get(s.slug)!, 'weak-candidate']);
    }
    if (candidates.length < m.min_rows) {
      throw new BoardShortfall(
        'only ' + candidates.length + ' protocols qualify (' + candidates.filter((c) => c[1] === 'candidate').length + ' no-token candidates, ' +
          candidates.filter((c) => c[1] === 'weak-candidate').length + ' set-aside no-token rows, ' + watch.size + ' watchlist) but the board needs ' + m.min_rows +
          '; the other ' + (live.length + unpriced.length) + ' protocols record a token, and ranking them as pre-token would misrepresent them',
      );
    }
  }
  const rows: BoardRow[] = candidates.map(([p, cls]) => {
    const age = ageDays(p.listed_at, snapshot.as_of);
    const word = p.name.toLowerCase().split(/[\s\-_.:()]+/)[0] ?? '';
    const siblings = (sib.get(word) ?? []).filter((x) => !x.startsWith(p.name + ' (') && x !== p.name);
    const cm: CategoryMultiple = cal.byCategory.get(p.category ?? 'Uncategorised') ?? cal.global;
    const a = sized ? r4(fit.a) : 0, b = sized ? r4(fit.b) : 1;
    const offset = sized && useCat ? r4(fit.offsets.get(p.category ?? 'Uncategorised')?.offset ?? 0) : 0;
    const mult = sized ? r4(baseValue(p.tvl_usd, { mapping, a, b, offset, multiple: 1 }) / Math.max(1, p.tvl_usd)) : (useCat ? cm.multiple : cal.global.multiple);
    const parts: ValueParts = {
      mapping, a, b, offset,
      multiple: mult,
      comps: useCat ? cm.comps : cal.global.comps,
      growth: factors ? growthFactor(p.change_7d, m) : 1,
      track: factors ? trackFactor(age, m) : 1,
      breadth: factors ? breadthFactor(p.chains.length, m) : 1,
      sibling: siblings.length ? m.sibling_factor : 1,
      cls: CLASS_FACTOR[cls],
      spread: Math.round((heldSpread + (p.change_7d === null ? m.missing_widen : 0) + (age === null ? m.missing_widen : 0)) * 10000) / 10000,
    };
    const value = impliedValue(p.tvl_usd, parts);
    const facts: Facts = { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: age, siblings, on_watchlist: cls === 'watchlist' || cls === 'watchlist-token' };
    const risk = riskOf(facts);
    const plan = farmPlan(facts, book);
    const sourced = plan.basis === 'official-source';
    const effort = effortOf(facts, sourced);
    const flags: string[] = [];
    if (useCat && cm === cal.global) flags.push('No traded comparable in its category: all-category multiple used');
    else if (useCat && cm.comps < 3) flags.push('Category multiple rests on ' + cm.comps + ' traded comparable' + (cm.comps === 1 ? '' : 's') + ', shrunk toward the all-category median');
    if (p.change_7d === null) flags.push('No 7-day change reported');
    if (age === null) flags.push('No listing date: track record unknown');
    if (siblings.length) flags.push('Possible related token: ' + siblings.slice(0, 2).join(', '));
    if (cls === 'weak-candidate') flags.push('Weak candidate, added only because the snapshot has under ' + m.min_rows + ' candidates: ' + setAsideReason(p));
    if (cls === 'watchlist-token') flags.push('On the watchlist but DefiLlama records a token (' + (p.symbol ?? p.gecko_id ?? 'recorded') + (p.mcap_usd ? ', market cap ' + Math.round(p.mcap_usd) : '') + '): shown for coverage, not a pre-token candidate');
    // Confidence in the estimate: how many traded comparables back the multiple, and how much data is missing.
    const confidence = cls === 'weak-candidate' || cls === 'watchlist-token' ? 'Low' : validation.comps < 10 ? 'Low' : (!useCat || cm.comps >= 5) && flags.length === 0 ? 'High' : (!useCat || cm.comps >= 2) && flags.length <= 1 ? 'Medium' : 'Low';
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      token_status: cls === 'watchlist-token' ? (tokenClass(p) === 'recorded-trades' ? 'token recorded and trading' : 'token recorded, no market cap') : 'no token recorded by DefiLlama',
      row_class: cls,
      classification: classify(p, cls, siblings),
      on_watchlist: cls === 'watchlist' || cls === 'watchlist-token',
      implied_value_usd: value,
      implied_range_usd: [Math.max(1, Math.round(value * Math.exp(-parts.spread))), Math.round(value * Math.exp(parts.spread))],
      confidence,
      model: { ...parts, category_basis: cm.category },
      opportunity: 0,
      risk,
      effort,
      cost: costOf(facts),
      playbook: playbookFor(p.category).label,
      signals: signalsOf(p, age),
      flags,
      farm_steps: plan.steps.map(stepString),
      research: researchPlan(facts, sourced),
      plan_basis: plan.basis,
      plan,
    } as BoardRow & { plan: Plan };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  // Keep the board within the gate's cap, never dropping a watchlist row.
  while (rows.length > m.max_rows) {
    let i = rows.length - 1;
    while (i >= 0 && rows[i]!.on_watchlist) i--;
    if (i < 0) break;
    rows.splice(i, 1);
  }
  // Opportunity: implied value per dollar of TVL, discounted by risk and effort, scaled so the best row is 100.
  const raw = rows.map((r) => (r.implied_value_usd / Math.max(1, r.tvl_usd)) * (1 - r.risk.score / 120) / (0.8 + 0.1 * r.effort.score));
  const top = Math.max(...raw, 1e-9);
  rows.forEach((r, i) => { r.rank = i + 1; r.opportunity = Math.round((raw[i]! / top) * 1000) / 10; });
  return { rows, cal, setAside, unpriced, live, validation };
}

/** Why a board is not one the gate will take, or null. Mirrors the sealed gate's board rows. */
export function boardIssue(rows: { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return 'the board has ' + rows.length + ' rows (100 to 4000)';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!known.has(r.slug)) return 'invented slug ' + r.slug;
    if (seen.has(r.slug)) return 'duplicate slug ' + r.slug;
    seen.add(r.slug);
    if (!r.name) return r.slug + ' has no name';
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return r.slug + ' has implied value ' + r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return r.slug + ' has ' + r.farm_steps.length + ' farm steps';
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return r.slug + ' has a farm step of ' + s.trim().length + ' characters';
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length) return 'the board misses watchlist slugs: ' + missing.slice(0, 5).join(', ');
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return 'ranks are not exactly 1..N';
    if (i && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'rank ' + (i + 1) + ' outvalues rank ' + i;
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size === 1) return 'every row shares one implied value';
  return null;
}

/** The dashboard's dataset: everything the page renders, as one script (no fetch, no network). */
export function radarData(snapshot: Snapshot, built: ReturnType<typeof buildBoard>, book: SourceBook | null, m: ModelConstants = MODEL) {
  const tokenTotals = { none: 0, trades: 0, unpriced: 0 };
  for (const p of snapshot.protocols) {
    const c = tokenClass(p);
    if (c === 'none-recorded') tokenTotals.none++;
    else if (c === 'recorded-trades') tokenTotals.trades++;
    else tokenTotals.unpriced++;
  }
  const cats = [...built.cal.byCategory.values()].sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: m,
    protocols: snapshot.protocols.length,
    watchlist: snapshot.watchlist,
    token_totals: tokenTotals,
    calibration: { global: built.cal.global, categories: cats },
    validation: built.validation,
    sources: book ? { retrieved: book.retrieved, method: book.method, slugs: Object.keys(book.protocols).filter((s) => built.rows.some((r) => r.slug === s)) } : null,
    rows: built.rows.map((r) => {
      const { farm_steps: _fs, ...rest } = r as BoardRow & { plan: unknown };
      return rest;
    }),
    set_aside: built.setAside.slice(0, 400),
    set_aside_total: built.setAside.length,
    unpriced: built.unpriced.slice(0, 60).map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, symbol: p.symbol, gecko_id: p.gecko_id })),
    unpriced_total: built.unpriced.length,
    live: [...built.live]
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
      .slice(0, 80)
      .map((p) => ({ slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: r2((p.mcap_usd ?? 0) / Math.max(1, p.tvl_usd)) })),
    live_total: built.live.length,
  };
}

/** board.json rows: the gate's fields first, then the model's own explanation. */
export function boardRows(built: ReturnType<typeof buildBoard>) {
  return built.rows.map((r) => {
    const { plan: _p, ...rest } = r as BoardRow & { plan: unknown };
    return rest;
  });
}
