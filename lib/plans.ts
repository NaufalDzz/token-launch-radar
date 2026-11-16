// Farm plans, research checklists, risk, effort and cost for one protocol.
//
// Two kinds of plan, never mixed up:
//   official-source   for the few protocols in lib/sources.json, whose own public docs were read on the
//                     date recorded there; steps cite what those pages establish and what they do not.
//   category-checklist for every other row: verification gates built from the snapshot record (category,
//                     chains, TVL, 7-day flow), then one optional example workflow for the category.
// The snapshot cannot show entry routes, points eligibility, KYC, gas or holding rules. Every cost, time,
// test size and hold length here is an assumption and is labelled so; none is an official requirement or
// an eligibility condition. No step asks for leverage, wash trading or repeated transactions made only to
// create activity, and nothing here claims a reward.

import { readFileSync } from 'node:fs';

export type StepKind = 'gate' | 'action' | 'monitor' | 'exit';
export type StepBasis = 'official source' | 'snapshot' | 'assumption' | 'checklist';

export interface Step {
  kind: StepKind;
  basis: StepBasis;
  text: string;
  cost: string;
  time: string;
}

export interface SourceRef {
  url: string;
  establishes: string;
  not_established: string;
}

export interface SourcedProtocol {
  product_type: string;
  product: string;
  access: string;
  sources: SourceRef[];
  steps: Step[];
}

export interface SourceBook {
  retrieved: string;
  method: string;
  protocols: Record<string, SourcedProtocol>;
}

/** The official-source notes kept beside this file: static text, never fetched at build or run time. */
export function loadSources(path = new URL('./sources.json', import.meta.url)): SourceBook {
  return JSON.parse(readFileSync(path, 'utf8')) as SourceBook;
}

export interface Playbook {
  id: string;
  label: string;
  example: string; // the optional example workflow, with {test} {chain} {gas} placeholders
  txs: number; // assumed transactions for entry and exit
  weekly_txs: number; // assumed upkeep transactions per week (0 for hold-only products)
  setup_min: number;
  weekly_min: number;
  hold_days: number;
  access_note: string; // what to check about access; never a claim that KYC is or is not required
  risk_base: number;
}

const PLAYBOOKS: Record<string, Playbook> = {
  vault: { id: 'vault', label: 'Curated vault deposit', example: 'deposit a test size of about ${test} into one of its vaults on {chain}; read the strategy, fee and withdrawal terms first', txs: 4, weekly_txs: 0, setup_min: 40, weekly_min: 10, hold_days: 60, access_note: 'some vaults are permissioned or whitelisted', risk_base: 15 },
  basis: { id: 'basis', label: 'Basis / yield product', example: 'deposit a test size of about ${test} into its main product on {chain}; write down what backs the yield and the withdrawal delay', txs: 4, weekly_txs: 0, setup_min: 45, weekly_min: 10, hold_days: 60, access_note: 'CeDeFi and basis products often gate access by region or KYC', risk_base: 27 },
  lend: { id: 'lend', label: 'Supply to a lending market', example: 'supply a test size of about ${test} of a stablecoin on {chain}; borrow only if you actually need the loan, never to inflate activity', txs: 4, weekly_txs: 0, setup_min: 40, weekly_min: 10, hold_days: 45, access_note: 'institutional pools may be permissioned', risk_base: 19 },
  cdp: { id: 'cdp', label: 'Use its stablecoin', example: 'acquire a test size of about ${test} of its stablecoin through its own mint or swap route on {chain}; if you mint, keep the collateral ratio far above the minimum', txs: 4, weekly_txs: 0, setup_min: 50, weekly_min: 10, hold_days: 45, access_note: 'mint routes are sometimes restricted to whitelisted minters', risk_base: 24 },
  dex: { id: 'dex', label: 'Provide liquidity', example: 'add one full-range liquidity position of about ${test} in a deep pair on {chain}; swap only when you need the trade, not to make volume', txs: 4, weekly_txs: 0, setup_min: 45, weekly_min: 10, hold_days: 45, access_note: 'front-ends may geoblock some regions', risk_base: 18 },
  perps: { id: 'perps', label: 'Trade only what you would trade anyway', example: 'if you already trade, route a trade you would make anyway through it on {chain} at no leverage; otherwise skip this protocol', txs: 4, weekly_txs: 0, setup_min: 45, weekly_min: 10, hold_days: 30, access_note: 'derivatives venues commonly restrict regions', risk_base: 30 },
  rwa: { id: 'rwa', label: 'Tokenised asset subscription', example: 'if eligible, subscribe the product minimum (or a test size of about ${test}) to one product on {chain}; record issuer, custodian and redemption window', txs: 4, weekly_txs: 0, setup_min: 90, weekly_min: 10, hold_days: 90, access_note: 'tokenised securities usually need investor checks', risk_base: 21 },
  stake: { id: 'stake', label: 'Stake or restake', example: 'stake a test size of about ${test} through it on {chain}; note the unbonding period and slashing terms before committing', txs: 4, weekly_txs: 0, setup_min: 40, weekly_min: 10, hold_days: 60, access_note: 'operator or institutional products may be permissioned', risk_base: 20 },
  chain: { id: 'chain', label: 'Use the network', example: 'bridge a test size of about ${test} through its official bridge and use one or two native apps you actually need; do not repeat transactions to look active', txs: 6, weekly_txs: 1, setup_min: 60, weekly_min: 15, hold_days: 45, access_note: 'bridges and apps on it have their own terms', risk_base: 22 },
  payments: { id: 'payments', label: 'Use it for a real payment', example: 'set up a wallet that supports it and make or receive a payment you genuinely need, keeping balances small', txs: 3, weekly_txs: 1, setup_min: 45, weekly_min: 10, hold_days: 30, access_note: 'card and payment products often require KYC', risk_base: 15 },
  market: { id: 'market', label: 'One position you hold a view on', example: 'take one small position (assumed $50 to $100) in a market where you hold a real view on {chain}; no self-trading or volume loops', txs: 3, weekly_txs: 0, setup_min: 40, weekly_min: 10, hold_days: 30, access_note: 'prediction and OTC markets commonly restrict regions', risk_base: 26 },
  bridge: { id: 'bridge', label: 'One transfer you need', example: 'use it for one cross-chain transfer you actually need between {chains}', txs: 2, weekly_txs: 0, setup_min: 30, weekly_min: 5, hold_days: 0, access_note: 'check supported routes and limits', risk_base: 22 },
  generic: { id: 'generic', label: 'Core product use', example: 'use its main product on {chain} once with a test size of about ${test}, following its own docs', txs: 4, weekly_txs: 0, setup_min: 60, weekly_min: 10, hold_days: 45, access_note: 'access rules are not visible in the snapshot', risk_base: 22 },
};

const CATEGORY_PLAYBOOK: Record<string, string> = {
  'Risk Curators': 'vault', 'Onchain Capital Allocator': 'vault', Yield: 'vault', 'Yield Aggregator': 'vault', 'Stablecoin Wrapper': 'vault',
  'Liquidity Manager': 'vault', 'Options Vault': 'vault', Indexes: 'vault', Farm: 'vault', 'Leveraged Farming': 'vault',
  'Basis Trading': 'basis', CeDeFi: 'basis',
  Lending: 'lend', 'Collateral Markets': 'lend', 'Uncollateralized Lending': 'lend', 'NFT Lending': 'lend',
  CDP: 'cdp', 'CDP Manager': 'cdp', 'Dual-Token Stablecoin': 'cdp', 'Algo-Stables': 'cdp',
  Dexs: 'dex', 'DEX Aggregator': 'dex',
  Derivatives: 'perps', 'Interest Rate Derivatives': 'perps', Options: 'perps',
  RWA: 'rwa', 'RWA Lending': 'rwa', 'Anchor BTC': 'rwa',
  'Staking Pool': 'stake', Restaking: 'stake', 'Decentralized BTC': 'stake', 'Governance Incentives': 'stake', Insurance: 'stake',
  'Liquid Staking': 'stake', 'Liquid Restaking': 'stake', 'Restaked BTC': 'stake',
  Chain: 'chain', Payments: 'payments', 'Crypto Card Issuer': 'payments',
  'Prediction Market': 'market', 'OTC Marketplace': 'market', Privacy: 'market',
  Bridge: 'bridge', 'Cross Chain Bridge': 'bridge', 'Canonical Bridge': 'bridge',
};

export function playbookFor(category: string | null): Playbook {
  return PLAYBOOKS[CATEGORY_PLAYBOOK[category ?? ''] ?? 'generic']!;
}

// Assumed gas per transaction in dollars: rough typical ranges, labelled as assumptions wherever shown.
const GAS: Record<string, [number, number]> = { Ethereum: [0.5, 8], Bitcoin: [0.5, 5], Tron: [0.3, 3] };
const CHEAP = new Set(['Solana', 'Sui', 'Aptos', 'Algorand', 'Stellar', 'Near', 'Ripple', 'Ton', 'Hedera', 'Cardano', 'Bittensor', 'Noble', 'Cosmos', 'Osmosis', 'Starknet']);
export function gasRange(chain: string): [number, number] {
  if (GAS[chain]) return GAS[chain]!;
  if (CHEAP.has(chain)) return [0.001, 0.05];
  return [0.01, 0.5];
}

/** Among the first three chains DefiLlama lists, the one with the lowest assumed gas; ties keep its order. */
export function cheapestChain(chains: string[]): string | null {
  let best: string | null = null;
  for (const c of chains.slice(0, 3)) if (best === null || gasRange(c)[1] < gasRange(best)[1]) best = c;
  return best;
}

const money = (x: number) => (x === 0 ? '$0' : x < 0.01 ? '<$0.01' : x < 1 ? '$' + x.toFixed(2) : '$' + Math.round(x).toLocaleString('en-US'));

export interface Facts {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  siblings: string[];
  on_watchlist: boolean;
}

export interface Risk {
  score: number;
  level: 'Low' | 'Medium' | 'High';
  parts: [string, number][];
}

/** A heuristic risk score from the record: category base plus age, flow, size, chain and related-token terms. */
export function riskOf(f: Facts): Risk {
  const pb = playbookFor(f.category);
  const parts: [string, number][] = [['Category: ' + pb.label.toLowerCase(), pb.risk_base]];
  const a = f.age_days;
  if (a === null) parts.push(['Listing date unknown', 10]);
  else if (a < 90) parts.push(['Tracked under 90 days', 18]);
  else if (a < 365) parts.push(['Tracked under a year', 10]);
  else if (a < 730) parts.push(['Tracked under two years', 4]);
  const c = f.change_7d;
  if (c === null) parts.push(['No 7-day TVL change reported', 5]);
  else if (c < -15) parts.push(['TVL fell ' + Math.abs(c).toFixed(1) + '% in 7 days', 15]);
  else if (c < -5) parts.push(['TVL fell ' + Math.abs(c).toFixed(1) + '% in 7 days', 8]);
  else if (c > 40) parts.push(['TVL rose ' + c.toFixed(0) + '% in 7 days (hot money can leave)', 6]);
  if (f.tvl_usd < 10e6) parts.push(['TVL under $10M', 12]);
  else if (f.tvl_usd < 50e6) parts.push(['TVL under $50M', 6]);
  else if (f.tvl_usd < 250e6) parts.push(['TVL under $250M', 2]);
  if (f.chains.length <= 1) parts.push(['Single chain', 4]);
  if (f.siblings.length) parts.push(['A related token may already trade', 6]);
  const score = Math.min(100, parts.reduce((s, p) => s + p[1], 0));
  return { score, level: score < 35 ? 'Low' : score < 55 ? 'Medium' : 'High', parts };
}

/** Assumed effort for the plan's example workflow: minutes and an assumed hold, scored 1 (light) to 5. */
export interface Effort {
  score: number;
  setup_min: number;
  weekly_min: number;
  hold_days: number;
}

export interface Cost {
  chain: string | null;
  gas_per_tx: [number, number];
  setup_usd: [number, number];
  monthly_usd: [number, number];
  test_usd: number;
}

export function effortOf(f: Facts, sourced = false): Effort {
  const pb = playbookFor(f.category);
  const setup = pb.setup_min + (sourced ? 0 : 20); // an unsourced row needs the extra verification time
  const load = setup / 60 + (pb.weekly_min * (Math.max(pb.hold_days, 7) / 7)) / 60;
  const score = load < 2.5 ? 1 : load < 4 ? 2 : load < 6 ? 3 : load < 9 ? 4 : 5;
  return { score, setup_min: setup, weekly_min: pb.weekly_min, hold_days: pb.hold_days };
}

/** A test size scaled loosely to the pool, so a small protocol is never asked for a large position. */
export function testSize(tvl: number): number {
  return tvl < 25e6 ? 250 : tvl < 250e6 ? 500 : 1000;
}

export function costOf(f: Facts): Cost {
  const pb = playbookFor(f.category);
  const chain = cheapestChain(f.chains);
  const gas = chain ? gasRange(chain) : ([0.01, 1] as [number, number]);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const bridgeIn: [number, number] = chain === 'Ethereum' ? [0, 0] : [0.5, 5];
  return {
    chain,
    gas_per_tx: gas,
    setup_usd: [r2(gas[0] * pb.txs + bridgeIn[0]), r2(gas[1] * pb.txs + bridgeIn[1])],
    monthly_usd: [r2(gas[0] * pb.weekly_txs * 4.3), r2(gas[1] * pb.weekly_txs * 4.3)],
    test_usd: testSize(f.tvl_usd),
  };
}

function hours(min: number): string {
  return min < 60 ? min + ' minutes' : min === 60 ? '1 hour' : (min / 60).toFixed(min % 60 ? 1 : 0) + ' hours';
}

export interface Plan {
  basis: 'official-source' | 'category-checklist';
  product_type: string;
  product: string;
  access: string;
  sources: SourceRef[];
  steps: Step[];
  assumptions: string[];
}

const CHAIN_LABEL: Record<string, string> = { Binance: 'BNB Chain', 'OP Mainnet': 'OP Mainnet', Optimism: 'OP Mainnet' };
export function chainLabel(c: string | null): string {
  return c === null ? 'its main chain' : CHAIN_LABEL[c] ?? c;
}

function fill(t: string, f: Facts, c: Cost): string {
  const gas = money(c.gas_per_tx[0]) + '-' + money(c.gas_per_tx[1]);
  return t
    .replaceAll('{test}', c.test_usd.toLocaleString('en-US'))
    .replaceAll('{chain}', chainLabel(c.chain))
    .replaceAll('{chains}', f.chains.slice(0, 2).join(' and ') || 'two supported chains')
    .replaceAll('{gas}', gas)
    .replaceAll('{setup}', money(c.setup_usd[0]) + '-' + money(c.setup_usd[1]))
    .replaceAll('{name}', f.name);
}

/** The farm plan: official-source steps where the protocol's own docs were read, else verification gates. */
export function farmPlan(f: Facts, book: SourceBook | null): Plan {
  const pb = playbookFor(f.category);
  const cost = costOf(f);
  const src = book?.protocols[f.slug] ?? null;
  const flow = f.change_7d === null ? 'no 7-day TVL change is on record' : 'the snapshot week moved TVL ' + (f.change_7d > 0 ? '+' : '') + f.change_7d.toFixed(1) + '%';
  const steps: Step[] = [];
  steps.push({
    kind: 'gate', basis: 'snapshot',
    text: 'Identity gate: reach ' + f.name + ' only via its DefiLlama page (defillama.com/protocol/' + f.slug + ') or its own docs, never links in replies or DMs. Snapshot: ' + (f.category ?? 'no category') + ' on ' + (f.chains.slice(0, 3).join(', ') || 'no listed chain') + '.',
    cost: 'free', time: '10 minutes',
  });
  if (src) {
    for (const s of src.steps) steps.push({ ...s, text: fill(s.text, f, cost), cost: fill(s.cost, f, cost), time: fill(s.time, f, cost) });
  } else {
    steps.push({
      kind: 'gate', basis: 'checklist',
      text: 'Product gate: find out what an ordinary user can actually do in ' + f.name + ' (deposit, swap, stake, mint) and which front-end serves it. The snapshot shows only its category; ' + pb.access_note + ', so read its terms and stop if access is unclear.',
      cost: 'free', time: '20 minutes',
    });
    steps.push({
      kind: 'gate', basis: 'checklist',
      text: 'Rewards gate: look for an official points or rewards page and what it counts. DefiLlama recording no token is not proof that none exists or is planned' + (f.siblings.length ? '; a related token already trades (' + f.siblings.slice(0, 2).join(', ') + '), so check whether it already covers this product' : '') + '. With no programme, any use is a speculative bet.',
      cost: 'free', time: '20 minutes',
    });
    steps.push({
      kind: 'action', basis: 'assumption',
      text: 'Optional example workflow (' + pb.label.toLowerCase() + '), only if every gate passes: ' + fill(pb.example, f, cost) + '. Gas on ' + chainLabel(cost.chain) + ' is assumed at ' + money(cost.gas_per_tx[0]) + '-' + money(cost.gas_per_tx[1]) + ' a transaction.',
      cost: money(cost.setup_usd[0]) + '-' + money(cost.setup_usd[1]) + ' gas + capital at protocol risk', time: hours(pb.setup_min),
    });
  }
  steps.push({
    kind: 'monitor', basis: 'assumption',
    text: (pb.hold_days ? 'Review weekly over an assumed ' + pb.hold_days + '-day horizon (not a protocol rule)' : 'Review once after the transfer') + '; exit if TVL falls 25% in a week or withdrawals pause (' + flow + ').',
    cost: 'free', time: '5 minutes a week',
  });
  steps.push({
    kind: 'exit', basis: 'checklist',
    text: 'Withdraw or claim only through links the official app or docs publish; never pay a fee to "claim"; log wallet, dates and transactions.',
    cost: 'free', time: '10 minutes',
  });
  const assumptions = [
    'Test size about $' + cost.test_usd.toLocaleString('en-US') + ' (scaled to TVL), chosen by this radar.',
    'Gas ' + money(cost.gas_per_tx[0]) + '-' + money(cost.gas_per_tx[1]) + ' a transaction on ' + chainLabel(cost.chain) + ', a typical range, not a quote.',
    'Times and the ' + pb.hold_days + '-day review horizon are planning guesses, not protocol rules or eligibility conditions.',
  ];
  return {
    basis: src ? 'official-source' : 'category-checklist',
    product_type: src ? src.product_type : pb.id,
    product: src ? src.product : 'Unverified: category ' + (f.category ?? 'unknown') + ' suggests ' + pb.label.toLowerCase() + '.',
    access: src ? src.access : 'Unknown from the snapshot; ' + pb.access_note + '.',
    sources: src ? src.sources : [],
    steps,
    assumptions,
  };
}

const KIND_LABEL: Record<StepKind, string> = { gate: 'Gate', action: 'Action', monitor: 'Monitor', exit: 'Exit' };

/** One board.json farm step: kind and basis first, then the text, then labelled cost and time. */
export function stepString(s: Step): string {
  const t = '[' + KIND_LABEL[s.kind] + ' · ' + s.basis + '] ' + s.text + ' Cost' + (s.cost === 'free' ? '' : ' (assumed)') + ': ' + s.cost + '. Time (assumed): ' + s.time + '.';
  return t.length > 600 ? t.slice(0, 597) + '...' : t;
}

/** The research checklist: what to establish before committing. */
export function researchPlan(f: Facts, sourced: boolean): string[] {
  const out = [
    'Token status: search CoinGecko, the docs and the official X account for a token, TGE or points announcement; the snapshot only says DefiLlama records none.',
    'Security: list audits and incidents; check whether contracts are upgradeable and who holds admin keys.',
    "Flow: re-check TVL against the snapshot's " + (f.change_7d === null ? 'missing 7-day change' : (f.change_7d > 0 ? '+' : '') + f.change_7d.toFixed(1) + '% 7-day change') + ' before entering.',
  ];
  if (!sourced) out.push('Access: confirm the front-end, any KYC, region or minimum rules, and withdrawal terms; none is visible in the snapshot.');
  if (f.siblings.length) out.push('Related token: ' + f.siblings.slice(0, 2).join(', ') + ' shares the name; confirm whether ' + f.name + ' would get its own token.');
  if (f.age_days !== null && f.age_days < 180) out.push('New listing (' + f.age_days + ' days tracked): look for the team, backers and any early-user programme.');
  if (f.age_days !== null && f.age_days > 1095) out.push('Tokenless for ' + (f.age_days / 365).toFixed(1) + ' years of tracking: look for a stated reason before farming.');
  return out;
}
