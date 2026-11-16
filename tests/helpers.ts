// Test helpers: synthetic snapshots, placeholder PNGs (test-only, never shipped as screenshots) and a
// replica of the sealed gate's seven rows, written from the published rules.
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

/** Deterministic PRNG so synthetic snapshots are reproducible. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const CATS = ['Lending', 'Dexs', 'Yield', 'RWA', 'Derivatives', 'Risk Curators', 'CDP', 'Chain', 'Bridge', 'Liquid Staking', 'CEX', null, 'Brand New Category'];
const CHAINS = ['Ethereum', 'Base', 'Arbitrum', 'Solana', 'Bitcoin', 'Sui', 'Monad', 'Tron', 'Some Unknown Chain'];

export interface SynthOpts { n: number; seed: number; tokenShare: number; noLive?: boolean; nullShare?: number; floor?: number }

export function synthSnapshot(o: SynthOpts) {
  const r = rng(o.seed);
  const protocols = [] as Record<string, unknown>[];
  for (let i = 0; i < o.n; i++) {
    const tok = r() < o.tokenShare;
    const tvl = Math.floor(5e6 * Math.exp(r() * 7));
    const nul = r() < (o.nullShare ?? 0.1);
    const name = (r() < 0.05 ? 'Alpha ' : '') + 'Proto' + i + (r() < 0.03 ? ' V2' : r() < 0.03 ? ' Staked' : '');
    protocols.push({
      slug: 'proto-' + i,
      name,
      category: CATS[Math.floor(r() * CATS.length)],
      chains: CHAINS.filter(() => r() < 0.3),
      tvl_usd: tvl,
      change_7d: nul ? null : Math.round((r() * 80 - 30) * 10000) / 10000,
      mcap_usd: tok && !o.noLive && r() < 0.8 ? Math.floor(tvl * Math.exp(r() * 4 - 2.5)) : null,
      listed_at: nul ? null : '20' + (19 + Math.floor(r() * 7)) + '-0' + (1 + Math.floor(r() * 9)) + '-1' + Math.floor(r() * 9),
      gecko_id: tok ? 'g' + i : null,
      symbol: tok ? (r() < 0.5 ? 'S' + i : '-') : null,
    });
  }
  // A token-bearing "Alpha" so the related-token rule has something to find.
  protocols.push({ slug: 'alpha-core', name: 'Alpha Core', category: 'Dexs', chains: ['Ethereum'], tvl_usd: 9e8, change_7d: 1, mcap_usd: o.noLive ? null : 3e8, listed_at: '2021-01-01', gecko_id: 'alpha', symbol: 'ALP' });
  protocols.sort((a, b) => ((a.slug as string) < (b.slug as string) ? -1 : 1));
  const floor = o.floor ?? 50_000_000;
  const watchlist = protocols.filter((p) => (p.tvl_usd as number) >= floor && p.gecko_id === null && p.symbol === null).map((p) => p.slug as string).slice(0, 60);
  return { as_of: '2026-11-14', source: 'synthetic test snapshot', floor_usd: floor, protocols, watchlist };
}

// ---- PNG (placeholder images for running the pipeline in tests only)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function png(w: number, h: number, shade = 30): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, shade); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function placeholderShots(dir: string) {
  mkdirSync(dir, { recursive: true });
  ['1-board.png', '2-detail.png', '3-filtered.png'].forEach((n, i) => writeFileSync(join(dir, n), png(1440, 900, 20 + i * 20)));
}

// ---- the gate's seven rows, as the published rules state them
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n.startsWith('.')) throw new Error('dot directory ' + n); out.push(...walk(p, base + n + '/')); }
    else out.push(base + n);
  }
  return out;
}
export function gate(out: string, snapshot: { protocols: { slug: string }[]; watchlist: string[] }): Record<string, string | true> {
  const res: Record<string, string | true> = {};
  try {
    const files = walk(join(out, 'dashboard'));
    let bytes = 0;
    for (const f of files) {
      const name = f.split('/').pop()!;
      if (!NAME.test(name)) throw new Error('bad name ' + f);
      const text = readFileSync(join(out, 'dashboard', f), 'utf8');
      bytes += Buffer.byteLength(text);
      const url = /https?:\/\//i;
      if (f.endsWith('.css') && url.test(text)) throw new Error('url in css ' + f);
      if (f.endsWith('.html')) {
        for (const m of text.matchAll(/\s[\w:-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) if (url.test(m[1]!)) throw new Error('url in attribute ' + f);
        for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) if (url.test(m[1]!)) throw new Error('url in style ' + f);
      }
      if (/\.(m?js|html)$/.test(f) && /(import\s*\(?\s*['"]https?:|from\s*['"]https?:|require\(\s*['"]https?:)/.test(text)) throw new Error('url import ' + f);
    }
    if (!files.includes('index.html') || !files.some((f) => f.endsWith('.css')) || !files.some((f) => f.endsWith('.js'))) throw new Error('missing index/css/js');
    if (files.length > 400 || bytes > 4 * 1024 * 1024) throw new Error('too big');
    res.dashboard_files = true;
  } catch (e) { res.dashboard_files = String(e); }
  const doc = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
  const rows = (Array.isArray(doc) ? doc : doc.rows) as { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }[];
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const bad = rows.filter((r) => !known.has(r.slug) || !r.name || !Number.isSafeInteger(r.rank) || r.rank < 1 || !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14 || !Array.isArray(r.farm_steps));
  const dup = new Set(rows.map((r) => r.slug)).size !== rows.length;
  res.board_file = rows.length >= 100 && rows.length <= 4000 && !bad.length && !dup && new Set(rows.map((r) => r.implied_value_usd)).size > 1 ? true : 'rows ' + rows.length + ' bad ' + bad.length + ' dup ' + dup;
  const s = [...rows].sort((a, b) => a.rank - b.rank);
  res.sorted_by_value = s.every((r, i) => r.rank === i + 1 && (i === 0 || r.implied_value_usd <= s[i - 1]!.implied_value_usd)) ? true : 'ranks/order wrong';
  const have = new Set(rows.map((r) => r.slug));
  const miss = snapshot.watchlist.filter((w) => !have.has(w));
  res.coverage = miss.length ? 'missing ' + miss.join(',') : true;
  res.farm_steps = rows.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every((x) => x.trim().length >= 20 && x.trim().length <= 600)) ? true : 'farm steps out of bounds';
  const shots = existsSync(join(out, 'screenshots')) ? readdirSync(join(out, 'screenshots')).filter((n) => !n.startsWith('.')) : [];
  res.screenshots = shots.length >= 3 && shots.length <= 4 && shots.every((n) => {
    const b = readFileSync(join(out, 'screenshots', n));
    if (b.length > 524288) return false;
    if (b.readUInt32BE(0) !== 0x89504e47) return true; // JPEG dimension parsing is not needed for these tests
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    return Math.max(w, h) <= 1440 && Math.min(w, h) >= 800;
  }) ? true : 'screenshots out of limits';
  const dossier = readFileSync(join(out, 'dossier.json'));
  const again = buildDossier(out, { text_max_bytes: 65536 }) as unknown as string | Uint8Array;
  res.dossier_matches = Buffer.from(again as string).equals(dossier) && dossier.length <= 1.5 * 1024 * 1024 ? true : 'dossier differs or too big';
  return res;
}
