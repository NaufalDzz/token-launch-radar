// End-to-end: run main.ts on the practice snapshot and on synthetic snapshots, then hold the output to
// the gate's seven rows (a local replica, not the sealed scorer), determinism, the actual dossier text,
// classification honesty, plan wording and the no-network rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gate, placeholderShots, synthSnapshot } from './helpers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const practice = process.env.TOKEN_RADAR_SNAPSHOT ?? join(root, '..', '..', 'token-radar-01', 'kit', 'token-radar-01-kit', 'input', 'snapshot.json');
const havePractice = existsSync(practice);
const skip = havePractice ? false : 'set TOKEN_RADAR_SNAPSHOT to the kit\'s input/snapshot.json';
const work = mkdtempSync(join(process.env.TOKEN_RADAR_TMP ?? tmpdir(), 'radar-'));
const shots = join(work, 'shots');
placeholderShots(shots);

function run(input: string, out: string): string {
  return execFileSync(process.execPath, [join(root, 'main.ts'), '--input', input, '--output', out, '--screenshots', shots], { encoding: 'utf8' });
}
function runRaw(input: string, out: string) {
  return spawnSync(process.execPath, [join(root, 'main.ts'), '--input', input, '--output', out, '--screenshots', shots], { encoding: 'utf8' });
}
function allPass(res: Record<string, string | true>) {
  for (const [k, v] of Object.entries(res)) assert.equal(v, true, k + ': ' + v);
}
type Row = { slug: string; rank: number; name: string; row_class: string; on_watchlist: boolean; token_status: string; confidence: string; flags: string[]; farm_steps: string[]; plan_basis: string; classification: { certainty: string; reason: string }; implied_value_usd: number; implied_range_usd: [number, number] };
const board = (out: string) => JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')).rows as Row[];
const write = (name: string, snap: unknown) => { const f = join(work, name + '.json'); writeFileSync(f, JSON.stringify(snap)); return f; };

test('practice: all seven replica gate rows pass and the run is byte-for-byte deterministic', { skip }, () => {
  const a = join(work, 'a'), b = join(work, 'b');
  run(practice, a);
  run(practice, b);
  allPass(gate(a, JSON.parse(readFileSync(practice, 'utf8'))));
  for (const f of ['board.json', 'dashboard/zz-data.js', 'dashboard/0-evidence.md', 'dossier.json']) assert.ok(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f + ' differs between runs');
});

test('practice: the dossier text carries every page source file whole, then the evidence', { skip }, () => {
  const text: string = JSON.parse(readFileSync(join(work, 'a', 'dossier.json'), 'utf8')).text;
  assert.ok(Buffer.byteLength(text) <= 65_536);
  for (const f of ['index.html', 'app.css', 'app.js', '0-evidence.md']) {
    assert.ok(text.includes(readFileSync(join(work, 'a', 'dashboard', f), 'utf8')), f + ' is not whole in the dossier text');
  }
  assert.ok(text.indexOf('### 0-evidence.md') < text.indexOf('### app.css'), 'evidence must sort first');
  // Only the generated data file may be cut, and it is named as such.
  const cut = /\[Cut at 65536 bytes: (\d+) files? and/.exec(text);
  if (cut) assert.ok(text.lastIndexOf('### index.html') < text.indexOf('[Cut at'), 'a page file was cut');
  assert.ok(readFileSync(join(work, 'a', 'dashboard', 'zz-data.js')).length > 100_000, 'the page still gets every row');
});

test('practice: the evidence is computed from the run and covers the required ground', { skip }, () => {
  const snap = JSON.parse(readFileSync(practice, 'utf8'));
  const rows = board(join(work, 'a'));
  const ev = readFileSync(join(work, 'a', 'dashboard', '0-evidence.md'), 'utf8');
  for (const h of ['## Coverage', '## Validation', '## Valuation', '## Classification', '## Plans', '## Source reading']) assert.ok(ev.includes(h), 'evidence lacks ' + h);
  assert.ok(ev.includes('Protocols read: ' + snap.protocols.length + '.'));
  assert.ok(ev.includes('Watchlist covered: ' + snap.watchlist.length + '/' + snap.watchlist.length));
  assert.ok(ev.includes('Ranked: ' + rows.length + ' rows'));
  assert.ok(ev.includes(rows[0]!.name + ' (#1'), 'worked example for the top row');
  assert.doesNotMatch(ev, /\bdiffers\b/, 'a worked example does not reproduce its board value');
  assert.ok((ev.match(/\bmatches\b/g) ?? []).length >= 2);
  assert.ok(ev.includes(', official-source)') && ev.includes(', category-checklist)'), 'differentiated plans');
  assert.match(ev, /not an independent final test/);
  assert.match(ev, /\| size \(used\) \| 0\.\d+/);
  assert.match(ev, /\(curator\): www\.steakhouse\.financial\/about ; /);
  assert.match(ev, /listing date[^.]*proxy/i);
  assert.doesNotMatch(ev, /\b(judge|verdict|grader|score this)\b/i);
  assert.ok(Buffer.byteLength(ev) <= 16_384);
});

test('practice: no recorded-token protocol is ranked; every row explains its classification', { skip }, () => {
  const snap = JSON.parse(readFileSync(practice, 'utf8'));
  const bySlug = new Map(snap.protocols.map((p: { slug: string }) => [p.slug, p]));
  for (const r of board(join(work, 'a'))) {
    const p = bySlug.get(r.slug) as { gecko_id: string | null; symbol: string | null; mcap_usd: number | null };
    assert.ok(p.gecko_id === null && p.symbol === null && !(p.mcap_usd! > 0), r.slug + ' records a token');
    assert.equal(r.on_watchlist, snap.watchlist.includes(r.slug));
    assert.match(r.token_status, /no token recorded/);
    assert.ok(['candidate', 'watchlist'].includes(r.row_class), r.slug + ' is ' + r.row_class);
    assert.ok(r.classification.reason.length > 40);
    if (r.flags.some((f) => f.startsWith('Possible related token'))) assert.equal(r.classification.certainty, 'uncertain');
    assert.ok(r.implied_range_usd[0] <= r.implied_value_usd && r.implied_value_usd <= r.implied_range_usd[1]);
  }
});

test('practice: plans label assumptions, cite sources only where read, and never manufacture activity', { skip }, () => {
  const rows = board(join(work, 'a'));
  const banned = /hedged positions|generate volume|swaps? (on it )?(each|a|per) week|several small payments|each week, sizing|round trips|\b[12]-?[12]?x leverage to/i;
  for (const r of rows) {
    for (const s of r.farm_steps) {
      assert.doesNotMatch(s, banned, r.slug + ': ' + s);
      assert.match(s, /^\[(Gate|Action|Monitor|Exit) · (official source|snapshot|assumption|checklist)\] /);
      assert.match(s, /Time \(assumed\)/);
      if (!/Cost: free\./.test(s)) assert.match(s, /Cost \(assumed\)/);
    }
    if (r.plan_basis === 'category-checklist') assert.ok(r.farm_steps.some((s) => s.includes('Optional example workflow')) && r.farm_steps.filter((s) => s.startsWith('[Gate')).length >= 3, r.slug);
  }
  const data = readFileSync(join(work, 'a', 'dashboard', 'zz-data.js'), 'utf8');
  const ctx: { window?: unknown; RADAR?: unknown } = {};
  ctx.window = ctx;
  vm.runInNewContext(data, ctx);
  const D = ctx.RADAR as { rows: { slug: string; plan_basis: string; plan: { product: string; access: string; sources: { url: string; establishes: string; not_established: string }[] } }[] };
  const plan = (slug: string) => D.rows.find((r: { slug: string }) => r.slug === slug)?.plan;
  assert.match(plan('steakhouse-financial').product, /curator/i);
  assert.match(plan('steakhouse-financial').product, /does not hold user assets/);
  assert.match(plan('steakhouse-financial').access, /partner Earn products/);
  assert.ok(D.rows.find((r) => r.slug === 'steakhouse-financial')!.plan.sources.some((s) => s.url.includes('docs.morpho.org')));
  assert.match(plan('veda').product, /infrastructure/i);
  assert.match(plan('veda').access, /partner/i);
  for (const r of D.rows.filter((x: { plan_basis: string }) => x.plan_basis === 'official-source')) {
    assert.ok(r.plan.sources.length && r.plan.sources.every((s: { url: string; establishes: string; not_established: string }) => /^https:\/\//.test(s.url) && s.establishes && s.not_established), r.slug);
  }
  for (const r of D.rows.filter((x: { plan_basis: string }) => x.plan_basis !== 'official-source')) assert.equal(r.plan.sources.length, 0);
});

test('shipped code makes no network request', () => {
  for (const f of readdirSync(join(root, 'dashboard'))) {
    const s = readFileSync(join(root, 'dashboard', f), 'utf8');
    assert.doesNotMatch(s, /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\(/, f);
    assert.doesNotMatch(s, /(src|href)=["']?https?:/i, f);
  }
  for (const f of ['main.ts', ...readdirSync(join(root, 'lib')).filter((n) => n.endsWith('.ts')).map((n) => 'lib/' + n)]) {
    const s = readFileSync(join(root, f), 'utf8');
    assert.doesNotMatch(s, /\bfetch\(|node:(http|https|net|dgram|tls)\b/, f);
  }
});

const cases: [string, Parameters<typeof synthSnapshot>[0]][] = [
  ['typical mixed universe', { n: 700, seed: 1, tokenShare: 0.5 }],
  ['no traded tokens at all (prior multiple only)', { n: 400, seed: 2, tokenShare: 0.4, noLive: true }],
  ['missing figures everywhere', { n: 300, seed: 4, tokenShare: 0.3, nullShare: 0.9 }],
  ['huge universe: board capped at 4000 with the watchlist kept', { n: 6000, seed: 5, tokenShare: 0.1, floor: 5_000_000 }],
];
for (const [name, opts] of cases) {
  test('synthetic: ' + name, () => {
    const snap = synthSnapshot(opts);
    const out = join(work, 'out-' + opts.seed);
    run(write('snap-' + opts.seed, snap), out);
    allPass(gate(out, snap));
    const rows = board(out);
    assert.ok(rows.length <= 4000);
    const bySlug = new Map(snap.protocols.map((p) => [p.slug as string, p]));
    for (const r of rows) assert.ok(bySlug.get(r.slug)!.gecko_id === null && bySlug.get(r.slug)!.symbol === null, r.slug + ' records a token');
    const dash = readdirSync(join(out, 'dashboard')).reduce((s, f) => s + readFileSync(join(out, 'dashboard', f)).length, 0);
    assert.ok(dash <= 4 * 1024 * 1024, 'dashboard/ is ' + dash + ' bytes');
    const ctx: { window?: unknown; RADAR?: { rows: { slug: string; implied_value_usd: number }[] } } = {};
    ctx.window = ctx;
    vm.runInNewContext(readFileSync(join(out, 'dashboard', 'zz-data.js'), 'utf8'), ctx);
    assert.equal(ctx.RADAR!.rows.map((r) => r.slug + ':' + r.implied_value_usd).join('\n'), rows.map((r) => r.slug + ':' + r.implied_value_usd).join('\n'), 'packed page data matches board.json');
    if (opts.seed === 2) assert.ok(rows.every((r) => (r as unknown as { model: { comps: number } }).model.comps === 0));
  });
}

test('synthetic: a thin universe fills with labelled weak no-token rows, never with token rows', () => {
  const snap = synthSnapshot({ n: 180, seed: 7, tokenShare: 0.4 });
  const out = join(work, 'out-thin');
  run(write('thin', snap), out);
  allPass(gate(out, snap));
  const rows = board(out);
  const weak = rows.filter((r) => r.row_class === 'weak-candidate');
  assert.ok(weak.length > 0, 'expected weak rows in this universe');
  for (const r of weak) {
    assert.equal(r.confidence, 'Low');
    assert.equal(r.classification.certainty, 'weak');
    assert.ok(r.flags.some((f) => f.startsWith('Weak candidate')));
  }
  const bySlug = new Map(snap.protocols.map((p) => [p.slug as string, p]));
  for (const r of rows) assert.equal(bySlug.get(r.slug)!.gecko_id, null);
});

test('adversarial: too few no-token protocols fails with an honest reason and writes no board', () => {
  const snap = synthSnapshot({ n: 130, seed: 3, tokenShare: 0.7 });
  const out = join(work, 'out-short');
  const res = runRaw(write('short', snap), out);
  assert.equal(res.status, 3, res.stderr);
  assert.match(res.stderr, /cannot fill an honest board: only \d+ protocols qualify/);
  assert.match(res.stderr, /misrepresent/);
  assert.ok(!existsSync(join(out, 'board.json')));
});

test('adversarial: a watchlist slug whose token trades stays covered, flagged and never called pre-token', () => {
  const snap = synthSnapshot({ n: 700, seed: 1, tokenShare: 0.5 });
  const traded = snap.protocols.find((p) => (p.mcap_usd as number | null) && p.gecko_id)!;
  snap.watchlist.push(traded.slug as string);
  const out = join(work, 'out-wl-token');
  run(write('wl-token', snap), out);
  allPass(gate(out, snap));
  const r = board(out).find((x) => x.slug === traded.slug)!;
  assert.equal(r.row_class, 'watchlist-token');
  assert.equal(r.on_watchlist, true);
  assert.match(r.token_status, /token recorded and trading/);
  assert.equal(r.confidence, 'Low');
  assert.ok(r.flags.some((f) => /not a pre-token candidate/.test(f)));
});

test('a malformed snapshot is refused with a message, not a crash trace', () => {
  const file = join(work, 'bad.json');
  writeFileSync(file, '{"as_of":"x"}');
  assert.throws(() => run(file, join(work, 'bad')), /as_of/);
});

test.after(() => { if (!process.env.TOKEN_RADAR_KEEP) rmSync(work, { recursive: true, force: true }); });
