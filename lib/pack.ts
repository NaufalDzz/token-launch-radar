// Packs the page data so every row fits the dashboard's 4 MiB limit, even on a 4000-row board.
//
// Rows repeat a lot of text (plan templates, risk notes, checklists). pack() writes:
//   S  a table of values that occur more than once (strings, sentence fragments, objects, arrays),
//   K  the row keys, so each row is an array in K's order,
//   D  the data with rows as arrays and repeated values as "\u0001" + base-36 index into S.
// A long string is split into sentence fragments and stored as "\u0004" + the fragments' references.
// The row's own name and slug inside its strings become "\u0002" and "\u0003".
// UNPACK (a few lines of plain JS written into zz-data.js) restores the exact object, and
// tests/pack.test.ts checks the round trip on real and synthetic boards.

type J = null | boolean | number | string | J[] | { [k: string]: J };
const REF = '\u0001', NAME = '\u0002', SLUG = '\u0003', JOIN = '\u0004', MISSING = '\u0005';
const SPLIT = /(?<=[.;:,)] )/;
const CTRL = /[\u0001-\u0005]/g;

/** Drops the five marker characters from row text (they never occur in real names) and marks the row's name and slug. */
function escapeRow(v: J, name: string, slug: string): J {
  if (typeof v === 'string') { let s = v.replace(CTRL, ''); if (slug.length > 2) s = s.split(slug).join(SLUG); if (name.length > 2) s = s.split(name).join(NAME); return s; }
  if (Array.isArray(v)) return v.map((x) => escapeRow(x, name, slug));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, escapeRow(x, name, slug)]));
  return v;
}

export function pack(data: { rows: Record<string, J>[] } & Record<string, J>): { S: J[]; K: string[]; D: J } {
  const K = [...new Set(data.rows.flatMap((r) => Object.keys(r)))];
  const rows = data.rows.map((r) => {
    const name = String(r.name ?? '').replace(CTRL, ''), slug = String(r.slug ?? '').replace(CTRL, '');
    const o: Record<string, J> = {};
    for (const [k, v] of Object.entries(r)) o[k] = k === 'name' ? name : k === 'slug' ? slug : escapeRow(v, name, slug);
    return o;
  });
  const count = new Map<string, number>();
  const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
  const many = (k: string) => (count.get(k) ?? 0) > 1;
  const visit = (v: J): void => {
    if (typeof v === 'string') { bump(JSON.stringify(v)); if (v.length > 40) for (const f of v.split(SPLIT)) bump(JSON.stringify(f)); return; }
    if (v && typeof v === 'object') { bump(JSON.stringify(v)); for (const x of Array.isArray(v) ? v : Object.values(v)) visit(x); }
  };
  for (const r of rows) for (const [k, x] of Object.entries(r)) if (k !== 'name' && k !== 'slug') visit(x);
  const S: J[] = [];
  const at = new Map<string, number>();
  const intern = (key: string, make: () => J): number => {
    let i = at.get(key);
    if (i === undefined) { i = S.length; S.push(null); at.set(key, i); S[i] = make(); }
    return i;
  };
  const encode = (v: J): J => {
    if (typeof v === 'string') {
      const key = JSON.stringify(v);
      if (v.length >= 8 && many(key)) return REF + intern(key, () => v).toString(36);
      if (v.length > 40) {
        const parts = v.split(SPLIT);
        if (parts.length > 1 && parts.some((f) => many(JSON.stringify(f)))) return JOIN + parts.map((f) => intern(JSON.stringify(f), () => f).toString(36)).join(',');
      }
      return v;
    }
    if (v && typeof v === 'object') {
      const key = JSON.stringify(v);
      const make = (): J => (Array.isArray(v) ? v.map(encode) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])));
      return key.length > 12 && many(key) ? REF + intern(key, make).toString(36) : make();
    }
    return v;
  };
  const D: Record<string, J> = {};
  for (const [k, v] of Object.entries(data)) if (k !== 'rows') D[k] = v;
  D.rows = rows.map((r) => K.map((k) => (!(k in r) ? MISSING : k === 'name' || k === 'slug' ? r[k]! : encode(r[k]!))));
  return { S, K, D };
}

/** Plain JS (no URLs, no network) that turns pack()'s output back into the original object. */
export const UNPACK = `function(P){var S=P.S,M={},C=String.fromCharCode,R=C(1),N=C(2),G=C(3),J=C(4),X=C(5);
function ref(i){return M.hasOwnProperty(i)?M[i]:(M[i]=dec(S[i]));}
function dec(v){if(typeof v==='string'){var c=v.charAt(0);if(c===R)return ref(parseInt(v.slice(1),36));if(c===J)return v.slice(1).split(',').map(function(i){return ref(parseInt(i,36));}).join('');return v;}
if(Array.isArray(v))return v.map(dec);if(v&&typeof v==='object'){var o={};for(var k in v)o[k]=dec(v[k]);return o;}return v;}
function nm(v,n,s){if(typeof v==='string')return v.indexOf(N)<0&&v.indexOf(G)<0?v:v.split(N).join(n).split(G).join(s);if(Array.isArray(v))return v.map(function(x){return nm(x,n,s);});
if(v&&typeof v==='object'){var o={};for(var k in v)o[k]=nm(v[k],n,s);return o;}return v;}
var D={};for(var k in P.D)if(k!=='rows')D[k]=P.D[k];
D.rows=P.D.rows.map(function(a){var o={},n=a[P.K.indexOf('name')],s=a[P.K.indexOf('slug')];P.K.forEach(function(k,i){if(a[i]===X)return;o[k]=k==='name'||k==='slug'?a[i]:nm(dec(a[i]),n,s);});return o;});
return D;}`;
