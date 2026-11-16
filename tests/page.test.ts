// Smoke test for dashboard/app.js without a browser: a small stub DOM runs the page on zz-data.js from a
// real main.ts run and drives its tabs, filters, sorting, detail view, stars and compare set.
// It checks the page's logic, not its look; real screenshots come from a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { placeholderShots } from './helpers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
import { existsSync, writeFileSync } from 'node:fs';
import { synthSnapshot } from './helpers.ts';

// The practice snapshot when available (TOKEN_RADAR_SNAPSHOT or the kit beside this repo), else a synthetic one.
const kitSnap = process.env.TOKEN_RADAR_SNAPSHOT ?? join(root, '..', '..', 'token-radar-01', 'kit', 'token-radar-01-kit', 'input', 'snapshot.json');
const work = mkdtempSync(join(process.env.TOKEN_RADAR_TMP ?? tmpdir(), 'page-'));
const practice = existsSync(kitSnap) ? kitSnap : join(work, 'synthetic.json');
if (!existsSync(kitSnap)) writeFileSync(practice, JSON.stringify(synthSnapshot({ n: 700, seed: 1, tokenShare: 0.5 })));
placeholderShots(join(work, 'shots'));
execFileSync(process.execPath, [join(root, 'main.ts'), '--input', practice, '--output', join(work, 'out'), '--screenshots', join(work, 'shots')]);

type H = (e: unknown) => void;
function el(id: string) {
  const handlers: Record<string, H[]> = {};
  const cls = new Set<string>();
  return {
    id, innerHTML: '', textContent: '', value: '', dataset: {} as Record<string, string>, children: [] as unknown[], handlers,
    classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c), toggle: (c: string, on?: boolean) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: (c: string) => cls.has(c) },
    setAttribute() {}, addEventListener(t: string, h: H) { (handlers[t] ??= []).push(h); }, querySelectorAll: () => [], focus() {}, setSelectionRange() {},
  };
}
/** A click target that answers closest()/matches() for the simple selectors app.js uses. */
function target(data: Record<string, string>, tag = 'button') {
  const t = {
    dataset: data, tagName: tag, checked: false,
    matches(sel: string) { return sel.split(',').some((s) => { const m = /^(\w+)?(?:\[data-([\w-]+)\])?$/.exec(s.trim()); if (!m) return false; const key = m[2]?.replace(/-(\w)/g, (_, c) => c.toUpperCase()); return (!m[1] || m[1] === tag) && (!key || key in data); }); },
    closest(sel: string) { return t.matches(sel) ? t : null; },
  };
  return t;
}

function boot(hash = '') {
  const els = new Map<string, ReturnType<typeof el>>();
  const get = (id: string) => { if (!els.has(id)) els.set(id, el(id)); return els.get(id)!; };
  const tabs = get('tabs');
  tabs.children = ['board', 'map', 'compare', 'watch', 'model', 'aside'].map((t) => { const b = el('tab-' + t); b.dataset.tab = t; return b; });
  const docH: Record<string, H[]> = {}, winH: Record<string, H[]> = {};
  const store = new Map<string, string>();
  const location = { hash, pathname: '/dashboard/index.html', search: '' };
  const ctx: Record<string, unknown> = {
    document: { getElementById: get, addEventListener: (t: string, h: H) => { (docH[t] ??= []).push(h); }, createElement: () => el('x'), body: { appendChild() {} } },
    location,
    history: { replaceState: (_: unknown, __: string, url: string) => { location.hash = url.startsWith('#') ? url : ''; } },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    confirm: () => true, alert: () => {}, Blob: class {}, URL: { createObjectURL: () => 'blob:x' }, FileReader: class {},
  };
  ctx.window = ctx;
  ctx.window = Object.assign(ctx, { addEventListener: (t: string, h: H) => { (winH[t] ??= []).push(h); } });
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(work, 'out', 'dashboard', 'zz-data.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(work, 'out', 'dashboard', 'app.js'), 'utf8'), ctx);
  const radar = ctx.RADAR as { rows: { slug: string; name: string; category: string | null; rank: number; risk: { level: string }; plan_basis: string; classification: { certainty: string } }[] };
  return {
    get, radar, location, store,
    click: (data: Record<string, string>, tag?: string) => docH.click!.forEach((h) => h({ target: target(data, tag), stopPropagation() {} })),
    nav: (h: string) => { location.hash = h; winH.hashchange!.forEach((f) => f({})); },
    change: (id: string, value: string) => { const e = get(id); e.value = value; (e.handlers.change ?? e.handlers.input)!.forEach((f) => f.call(e, {})); },
  };
}

test('board renders every row count, the KPIs and a footer that confirms the recomputation', () => {
  const p = boot();
  const n = p.radar.rows.length;
  assert.match(p.get('foot').innerHTML, new RegExp(n + ' of ' + n + ' implied values were recomputed'));
  assert.match(p.get('kpis').innerHTML, /ranked on the board/);
  assert.match(p.get('kpis').innerHTML, /checked out of sample[\s\S]*held-out error 0\.\d+ dex[\s\S]*not an independent test/);
  assert.match(p.get('count').textContent, new RegExp('of ' + n + ' matching'));
  assert.match(p.get('view').innerHTML, /Implied value/);
});

test('every tab renders without throwing', () => {
  const p = boot();
  for (const [tab, want] of [['map', '<svg'], ['compare', 'Tick'], ['watch', 'Star protocols'], ['model', 'Held-out check on traded tokens'], ['aside', 'set aside'], ['board', 'Rank']]) {
    p.click({ tab });
    assert.ok(p.get('view').innerHTML.includes(want), tab + ' lacks ' + want);
  }
});

test('category and risk filters narrow the board to matching rows; reset restores it', () => {
  const p = boot();
  const want = p.radar.rows.filter((r) => r.category === 'RWA' && r.risk.level === 'Low').length;
  p.change('f-cat', 'RWA');
  p.change('f-risk', 'Low');
  assert.match(p.get('count').textContent, new RegExp('of ' + want + ' matching'));
  assert.match(p.location.hash, /cat=RWA/);
  p.click({ reset: '1' });
  assert.match(p.get('count').textContent, new RegExp('of ' + p.radar.rows.length + ' matching'));
});

test('a hash opens the detail view: value build-up and plan side by side, then checklist and notes', () => {
  const rows = boot().radar.rows;
  for (const r of [rows.find((x) => x.plan_basis === 'official-source'), rows.find((x) => x.plan_basis === 'category-checklist')]) {
    if (!r) continue;
    const d = boot('#p=' + r.slug).get('drawer').innerHTML;
    for (const s of ['held-out error', 'Sensitivity', 'How the value is built', 'recomputed in this page', 'Farm plan', 'Research checklist', 'Illustrative arithmetic', 'Token status', 'Opportunity', 'Confidence', 'Assumptions, not requirements', 'proxy']) assert.ok(d.includes(s), r.slug + ' detail lacks ' + s);
    const cols = d.indexOf('class="dcols"');
    assert.ok(cols > 0 && d.indexOf('How the value is built') > cols && d.indexOf('Farm plan') > d.indexOf('How the value is built') && d.indexOf('Farm plan') < d.indexOf('Research checklist'), 'value and plan share the first two-column block');
    if (r.plan_basis === 'official-source') assert.ok(d.includes('Sources read') && d.includes('from official docs') && !/href="http/.test(d));
    else assert.ok(d.includes('research checklist') && !d.includes('Sources read'));
  }
});

test('plan and classification filters narrow the board', () => {
  const p = boot();
  p.change('f-set', 'sourced');
  assert.match(p.get('count').textContent, new RegExp('of ' + p.radar.rows.filter((r) => r.plan_basis === 'official-source').length + ' matching'));
  p.change('f-set', 'uncertain');
  assert.match(p.get('count').textContent, new RegExp('of ' + p.radar.rows.filter((r) => r.classification.certainty !== 'clear').length + ' matching'));
});

test('sorting by a column reorders the table', () => {
  const p = boot();
  p.click({ sort: 'tvl' }, 'th');
  const first = /data-open="([^"]+)"/.exec(p.get('view').innerHTML)![1];
  const top = [...p.radar.rows].sort((a, b) => (b as unknown as { tvl_usd: number }).tvl_usd - (a as unknown as { tvl_usd: number }).tvl_usd)[0]!.slug;
  assert.equal(first, top);
});

test('stars persist to localStorage and feed the watchlist tab; compare holds at most 4', () => {
  const p = boot();
  const rows = p.radar.rows;
  p.click({ star: rows[0]!.slug });
  assert.match(p.store.get('tokenRadar.watch') ?? '', new RegExp(rows[0]!.slug));
  p.click({ tab: 'watch' });
  assert.ok(p.get('view').innerHTML.includes(rows[0]!.name));
  for (const r of rows.slice(0, 6)) p.click({ cmpbtn: r.slug });
  assert.equal(JSON.parse(p.store.get('tokenRadar.compare')!).length, 4);
  p.click({ tab: 'compare' });
  assert.ok(p.get('view').innerHTML.includes(rows[5]!.name));
});

test.after(() => rmSync(work, { recursive: true, force: true }));
