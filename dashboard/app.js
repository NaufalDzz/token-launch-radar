// Token Radar dashboard. Reads window.RADAR from zz-data.js (written by main.ts into dashboard/) and renders
// the board, a radar map, a protocol detail view, comparison, a local watchlist, the value model and the
// set-aside list. No network: every figure is in zz-data.js; stars, notes and checklists stay in this browser.
(function () {
  'use strict';
  var D = window.RADAR, $ = function (id) { return document.getElementById(id); };
  if (!D) { $('view').innerHTML = '<div class="empty">zz-data.js is missing: run main.ts, which writes it into dashboard/.</div>'; return; }
  var M = D.model, ROWS = D.rows, BY = {};
  ROWS.forEach(function (r) { BY[r.slug] = r; });

  // ---- local storage
  function load(k, d) { try { var v = localStorage.getItem('tokenRadar.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('tokenRadar.' + k, JSON.stringify(v)); } catch (e) { /* storage off: session only */ } }
  var watch = load('watch', {}), cmp = load('compare', []).filter(function (s) { return BY[s]; }), checks = load('checks', {}), calc = load('calc', { deposit: 1000, share: 10 });
  var DEF = { tab: 'board', q: '', cat: '', chain: '', set: '', risk: '', conf: '', tvl: 0, effort: 9, sort: 'rank', dir: 1, p: '' };
  var S = Object.assign({}, DEF), limit = 60;

  // ---- formatting
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function usd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    return '$' + (a < 10 ? n.toFixed(2) : Math.round(n));
  }
  function pct(n) { return n == null ? '<span class="mu">n/a</span>' : '<span class="' + (n > 0 ? 'up' : n < 0 ? 'dn' : 'mu') + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>'; }
  function age(d) { return d == null ? '<span class="mu">unknown</span>' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function range(a) { return usd(a[0]) + ' – ' + usd(a[1]); }
  function dots(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '●' : '<s>●</s>'; return '<span class="dots" title="Effort ' + n + '/5 (assumed)">' + s + '</span>'; }
  function pill(t, c) { return '<span class="pill ' + (c || '') + '">' + t + '</span>'; }
  function risk(r) { return '<span class="risk ' + r.risk.level + '">' + r.risk.score + '</span>'; }
  function conf(c) { return '<span class="conf ' + c + '">' + c + '</span>'; }
  function gas(r) { return usd(r.cost.setup_usd[0]) + '–' + usd(r.cost.setup_usd[1]); }
  function tbl(head, body, cls) { return '<div class="tbl"><table' + (cls ? ' class="' + cls + '"' : '') + '><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'; }
  function ths(a) { return a.map(function (h) { return '<th>' + h + '</th>'; }).join(''); }
  var SRC = function (r) { return r.plan_basis === 'official-source'; };

  // ---- the value model, recomputed in the page from the snapshot's own figures (lib/model.ts is the source)
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function r4(x) { return Math.round(x * 10000) / 10000; }
  function growthF(c7, w) { return c7 == null ? 1 : r4(1 + ((w == null ? M.growth_weight : w) * clamp(c7, M.growth_floor, M.growth_cap)) / 100); }
  function trackF(a) {
    if (a == null) return M.track_unknown;
    var f = M.track_base + (M.track_span * Math.min(a, M.track_full_days)) / M.track_full_days;
    if (a > M.fade_after_days) f *= Math.max(M.fade_floor, 1 - ((1 - M.fade_floor) * (a - M.fade_after_days)) / M.fade_after_days);
    return r4(f);
  }
  function breadthF(n) { return r4(1 + M.breadth_step * clamp(n - 1, 0, M.breadth_max_extra_chains)); }
  // base: the mapping chosen by held-out error (size-aware fit or a multiple); then heuristic adjustments
  function isSize(m) { return m.mapping.indexOf('size') === 0; }
  function isFx(m) { return /\+factors$/.test(m.mapping); }
  function baseV(m, tvl) { return isSize(m) ? Math.exp(m.a + m.b * Math.log(Math.max(1, tvl)) + m.offset) : tvl * m.multiple; }
  function implied(r, o) {
    o = o || {}; var m = r.model, sib = m.sibling < 1 ? (o.sib == null ? M.sibling_factor : o.sib) : 1, fx = isFx(m) || o.fx;
    return Math.max(1, Math.round(baseV(m, r.tvl_usd) * (fx ? growthF(r.change_7d, o.gw) * trackF(r.age_days) * breadthF(r.chains.length) : 1) * sib * m.cls));
  }
  var V = D.validation, VSEL = V.results.filter(function (x) { return x.id === V.selected; })[0];
  function vres(id) { return V.results.filter(function (x) { return x.id === id; })[0]; }
  var FXV = vres({ size: 'size+factors', 'size+category': 'size+category+factors', category: 'category+factors' }[V.selected]);
  function x3(d) { return '×/÷' + Math.pow(10, d).toFixed(1); }
  var verified = ROWS.filter(function (r) { return implied(r) === r.implied_value_usd; }).length;

  // ---- state in the URL hash, so any view can be linked or reopened
  function readHash() {
    var o = Object.assign({}, DEF);
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0 && kv.slice(0, i) in DEF) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    o.tvl = +o.tvl || 0; o.effort = +o.effort || 9; o.dir = +o.dir || 1; S = o;
  }
  function writeHash() {
    var p = Object.keys(DEF).filter(function (k) { return String(S[k]) !== String(DEF[k]); }).map(function (k) { return k + '=' + encodeURIComponent(S[k]); });
    try { history.replaceState(null, '', p.length ? '#' + p.join('&') : location.pathname + location.search); } catch (e) { location.hash = p.join('&'); }
  }

  // ---- filters and sorting
  var SORT = {
    rank: function (r) { return r.rank; }, name: function (r) { return r.name.toLowerCase(); }, tvl: function (r) { return r.tvl_usd; },
    c7: function (r) { return r.change_7d == null ? -1e9 : r.change_7d; }, age: function (r) { return r.age_days == null ? -1 : r.age_days; },
    value: function (r) { return r.implied_value_usd; }, risk: function (r) { return r.risk.score; }, effort: function (r) { return r.effort.score; },
    cost: function (r) { return r.cost.setup_usd[1]; }, opp: function (r) { return r.opportunity; }, conf: function (r) { return { High: 3, Medium: 2, Low: 1 }[r.confidence]; },
  };
  var SETS = {
    watchlist: function (r) { return r.on_watchlist; }, early: function (r) { return r.tvl_usd < D.floor_usd; },
    sourced: SRC, uncertain: function (r) { return r.classification.certainty !== 'clear'; },
    new: function (r) { return r.signals.some(function (s) { return s.indexOf('New') === 0; }); }, inflow: function (r) { return r.signals.indexOf('Strong inflow') >= 0; },
    starred: function (r) { return !!watch[r.slug]; },
  };
  function filtered() {
    var q = S.q.trim().toLowerCase();
    var out = ROWS.filter(function (r) {
      return !(q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) &&
        !(S.cat && (r.category || 'Uncategorised') !== S.cat) && !(S.chain && r.chains.indexOf(S.chain) < 0) &&
        !(S.risk && r.risk.level !== S.risk) && !(S.conf && r.confidence !== S.conf) &&
        r.tvl_usd >= S.tvl && r.effort.score <= S.effort && !(S.set && SETS[S.set] && !SETS[S.set](r));
    });
    var f = SORT[S.sort] || SORT.rank, d = S.sort === 'rank' || S.sort === 'name' ? S.dir : -S.dir;
    return out.sort(function (a, b) { var x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * d; });
  }

  // ---- header, KPIs, filter options
  function header() {
    var tt = D.token_totals, sum = ROWS.reduce(function (s, r) { return s + r.implied_value_usd; }, 0), cov = ROWS.filter(function (r) { return r.on_watchlist; }).length;
    $('meta').innerHTML = 'Snapshot <b>' + esc(D.as_of) + '</b> · ' + esc(D.source) + '<br>Watchlist floor ' + usd(D.floor_usd) + ' TVL · model <b>' + esc(M.version) + '</b> ' + pill('Estimates: not prices, launch dates or promised rewards', 'est');
    $('kpis').innerHTML = [
      [D.protocols, 'protocols scanned', 'the whole snapshot'],
      [tt.none, 'record no token', 'no CoinGecko id, ticker or market cap'],
      [ROWS.length, 'ranked on the board', 'watchlist ' + cov + '/' + D.watchlist.length + ' · ' + ROWS.filter(SETS.early).length + ' below the floor'],
      [ROWS.filter(SRC).length + ' / ' + ROWS.length, 'plans from official docs', (D.sources ? 'read ' + esc(D.sources.retrieved) : 'none') + '; the rest are checklists'],
      [tt.trades + tt.unpriced, 'record a token: not ranked', tt.trades + ' trade and set the multiples'],
      [usd(sum), 'board implied value', 'sum of row estimates'],
    ].map(function (x) { return '<div class="kpi"><div class="v num">' + x[0] + '</div><div class="l">' + x[1] + '</div><div class="s">' + x[2] + '</div></div>'; }).join('') +
      '<div class="vstrip"><div><b>Value model, checked out of sample.</b> ' + esc(VSEL.label) + ' had ' + V.folds + '-fold held-out error ' + VSEL.mdae_dex + ' dex (' + x3(VSEL.mdae_dex) + ') on ' + V.comps + ' traded tokens; ' + Math.round(VSEL.within_3x * 100) + '% within ×3.' + (FXV && FXV.id !== V.selected ? ' With fixed growth/age/breadth heuristics: ' + FXV.mdae_dex + ' dex, so they are shown per row as a sensitivity, not in the value.' : '') + ' The same folds chose the mapping (not an independent test). A proxy fitted on launched tokens, not launch odds.</div>' + vtable(true) + '</div>';
    function opts(id, label, fn) {
      var c = {}; ROWS.forEach(function (r) { [].concat(fn(r)).forEach(function (v) { c[v] = (c[v] || 0) + 1; }); });
      $(id).innerHTML = '<option value="">' + label + '</option>' + Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); }).map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');
    }
    opts('f-cat', 'All categories', function (r) { return r.category || 'Uncategorised'; });
    opts('f-chain', 'All chains', function (r) { return r.chains; });
    $('foot').innerHTML = 'Reads only the DefiLlama snapshot of ' + esc(D.as_of) + '. "No token recorded" describes the record, not proof. Values are estimates; no airdrop, reward or launch is known or promised. Plan costs and times are assumptions. ' + verified + ' of ' + ROWS.length + ' implied values were recomputed in this page and match board.json.';
  }
  function syncControls() {
    ['q', 'cat', 'chain', 'set', 'risk', 'conf', 'tvl', 'effort'].forEach(function (k) { $('f-' + k).value = String(S[k]); });
    [].forEach.call($('tabs').children, function (b) { b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false'); });
    $('filters').classList.toggle('hidden', ['board', 'map'].indexOf(S.tab) < 0);
    $('n-compare').textContent = cmp.length; $('n-watch').textContent = Object.keys(watch).length;
  }

  // ---- board
  function vbar(r, max) {
    var lo = Math.log10(max) - 4, lg = function (v) { return clamp((Math.log10(Math.max(v, 1)) - lo) / (Math.log10(max) - lo) * 100, 0, 100); };
    return '<div class="vbar" title="Range ' + range(r.implied_range_usd) + '"><i style="left:' + lg(r.implied_range_usd[0]) + '%;right:' + (100 - lg(r.implied_range_usd[1])) + '%"></i><b style="left:' + lg(r.implied_value_usd) + '%"></b></div>';
  }
  function th(key, label, cls) { return '<th data-sort="' + key + '" class="' + (cls || '') + '"' + (S.sort === key ? ' aria-sort="' + ((S.sort === 'rank' || S.sort === 'name' ? S.dir : -S.dir) > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + label + '</th>'; }
  function chips(r, n) { return r.chains.slice(0, n).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + (r.chains.length > n ? '<span class="chip">+' + (r.chains.length - n) + '</span>' : ''); }
  function rowHtml(r, max) {
    return '<tr data-open="' + r.slug + '"' + (S.p === r.slug ? ' class="sel"' : '') + '><td><button class="star' + (watch[r.slug] ? ' on' : '') + '" data-star="' + r.slug + '" title="Star to my watchlist" aria-label="Star ' + esc(r.name) + '">★</button></td><td class="n">' + r.rank + '</td>' +
      '<td><div class="name">' + esc(r.name) + (r.on_watchlist ? ' <span class="wl" title="On the house watchlist">WL</span>' : '') + (SRC(r) ? ' <span class="src" title="Plan uses official docs">DOCS</span>' : '') + (r.classification.certainty !== 'clear' ? ' <span class="unc" title="' + esc(r.classification.reason) + '">' + r.classification.certainty + '</span>' : '') + '<small>' + esc(r.category || 'Uncategorised') + '</small></div>' +
      '<div class="chips">' + chips(r, 3) + r.signals.map(function (s) { return '<span class="sig' + (s === 'Outflow' ? ' out' : '') + '">' + esc(s) + '</span>'; }).join('') + '</div></td>' +
      '<td class="n">' + usd(r.tvl_usd) + '</td><td class="n">' + pct(r.change_7d) + '</td><td class="n">' + age(r.age_days) + '</td><td class="n"><b class="num">' + usd(r.implied_value_usd) + '</b>' + vbar(r, max) + '</td>' +
      '<td>' + conf(r.confidence) + '</td><td>' + risk(r) + '</td><td>' + dots(r.effort.score) + '</td><td class="n">' + gas(r) + '</td><td class="n">' + r.opportunity.toFixed(0) + '</td>' +
      '<td><input type="checkbox" data-cmp="' + r.slug + '" title="Add to compare"' + (cmp.indexOf(r.slug) >= 0 ? ' checked' : '') + ' aria-label="Compare ' + esc(r.name) + '"></td></tr>';
  }
  function board() {
    var rows = filtered(), max = ROWS[0] ? ROWS[0].implied_range_usd[1] : 1;
    $('count').textContent = 'Showing ' + Math.min(limit, rows.length) + ' of ' + rows.length + ' matching · ' + ROWS.length + ' on the board';
    var t = tbl('<th title="Starred">★</th>' + th('rank', 'Rank', 'n') + th('name', 'Protocol') + th('tvl', 'TVL', 'n') + th('c7', '7d TVL', 'n') + th('age', 'Listed', 'n') + th('value', 'Implied value · range', 'n') + th('conf', 'Conf.') + th('risk', 'Risk') + th('effort', 'Effort') + th('cost', 'Set-up gas*', 'n') + th('opp', 'Opp.', 'n') + '<th title="Compare">⇄</th>',
      rows.length ? rows.slice(0, limit).map(function (r) { return rowHtml(r, max); }).join('') : '<tr><td colspan="13" class="empty">No protocol matches these filters. <button class="btn" data-reset="1">Reset filters</button></td></tr>') +
      (rows.length > limit ? '<button class="btn more" data-more="1">Show ' + Math.min(60, rows.length - limit) + ' more</button>' : '') + '<p class="note">* assumed gas for the example workflow, not a quote. Listed = time since DefiLlama listed it, a proxy for time without a token.</p>';
    return '<div class="layout"><div>' + t + '</div>' + side(rows) + '</div>';
  }
  function side(rows) {
    var cat = {}, tot = 0, lv = { Low: 0, Medium: 0, High: 0 };
    rows.forEach(function (r) { var c = r.category || 'Uncategorised'; cat[c] = (cat[c] || 0) + r.implied_value_usd; tot += r.implied_value_usd; lv[r.risk.level]++; });
    var top = Object.keys(cat).sort(function (a, b) { return cat[b] - cat[a]; }).slice(0, 7), mx = top.length ? cat[top[0]] : 1;
    var opp = rows.slice().sort(function (a, b) { return b.opportunity - a.opportunity; }).slice(0, 6);
    return '<div class="side"><div class="card"><h3>Implied value in view</h3><div class="big num">' + usd(tot) + '</div><div class="note">' + rows.length + ' protocols · risk: <span class="up">' + lv.Low + ' low</span>, <span class="wn">' + lv.Medium + ' medium</span>, <span class="dn">' + lv.High + ' high</span></div>' +
      '<div class="bars" style="margin-top:10px">' + top.map(function (c) { return '<div><span title="' + esc(c) + '">' + esc(c.length > 16 ? c.slice(0, 15) + '…' : c) + '</span><span class="b" style="width:' + Math.max(2, cat[c] / mx * 100) + '%"></span><span class="num">' + Math.round(cat[c] / tot * 100) + '%</span></div>'; }).join('') + '</div></div>' +
      '<div class="card"><h3>Best opportunity index</h3>' + opp.map(function (r) { return '<div class="row" data-open="' + r.slug + '"><span>' + esc(r.name) + ' ' + risk(r) + '</span><b class="num">' + r.opportunity.toFixed(0) + '</b></div>'; }).join('') +
      '<p class="note"><b>Value</b> estimates what a token could be worth; <b>opportunity</b> (0–100) ranks value per $ TVL after risk and effort; <b>confidence</b> grades the evidence, not launch odds. DOCS = plan from official docs; others are checklists.</p></div></div>';
  }

  // ---- radar map
  function map() {
    var rows = filtered(); if (!rows.length) return '<div class="empty">No protocol matches these filters.</div>';
    var W = 1100, H = 500, L = 60, B = 40, mx = Math.max.apply(null, rows.map(function (r) { return r.implied_value_usd; }));
    var lt = rows.map(function (r) { return Math.log10(Math.max(r.tvl_usd, 1)); }), x0 = Math.floor(Math.min.apply(null, lt)), x1 = Math.max(Math.ceil(Math.max.apply(null, lt)), x0 + 1);
    var X = function (t) { return L + (Math.log10(Math.max(t, 1)) - x0) / (x1 - x0) * (W - L - 20); }, Y = function (v) { return 15 + (60 - clamp(v == null ? 0 : v, -40, 60)) / 100 * (H - B - 15); };
    var col = { Low: '#4ade80', Medium: '#f5b942', High: '#f87171' }, g = '';
    for (var e = x0; e <= x1; e++) g += '<line x1="' + X(Math.pow(10, e)) + '" x2="' + X(Math.pow(10, e)) + '" y1="15" y2="' + (H - B) + '"/><text x="' + X(Math.pow(10, e)) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + usd(Math.pow(10, e)) + '</text>';
    [-40, -20, 0, 20, 40, 60].forEach(function (v) { g += '<line x1="' + L + '" x2="' + (W - 20) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"' + (v === 0 ? ' style="stroke:#3a4a70"' : '') + '/><text x="' + (L - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + (v > 0 ? '+' : '') + v + '%</text>'; });
    var pts = rows.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    var c = pts.map(function (r) { return '<circle data-open="' + r.slug + '" cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.change_7d).toFixed(1) + '" r="' + (3 + 16 * Math.sqrt(r.implied_value_usd / mx)).toFixed(1) + '" fill="' + col[r.risk.level] + '" fill-opacity="' + (r.change_7d == null ? 0.25 : 0.7) + '"><title>' + esc(r.name) + ' · ' + usd(r.implied_value_usd) + ' implied · TVL ' + usd(r.tvl_usd) + ' · 7d ' + (r.change_7d == null ? 'n/a' : r.change_7d.toFixed(1) + '%') + ' · risk ' + r.risk.score + '</title></circle>'; }).join('');
    var lab = pts.slice(0, 12).map(function (r) { return '<text x="' + (X(r.tvl_usd) + 6).toFixed(1) + '" y="' + (Y(r.change_7d) - 6).toFixed(1) + '" class="lb">' + esc(r.name) + '</text>'; }).join('');
    $('count').textContent = rows.length + ' protocols plotted';
    return '<div class="map"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Protocols by TVL and 7-day TVL change">' + g + c + lab + '<text x="' + (W / 2) + '" y="' + (H - 4) + '" text-anchor="middle">TVL (log scale) →</text><text x="14" y="' + (H / 2) + '" transform="rotate(-90 14 ' + (H / 2) + ')" text-anchor="middle">7-day TVL change</text></svg></div>' +
      '<div class="legend"><span><i style="background:#4ade80"></i>Low risk</span><span><i style="background:#f5b942"></i>Medium</span><span><i style="background:#f87171"></i>High</span><span>Bubble area ∝ implied value · faded = no 7-day change on record (drawn at 0%) · click a bubble for detail</span></div>';
  }

  // ---- detail: value rationale (left) beside the plan (right), then risk, cost, arithmetic, checklist, notes
  var KIND = { gate: 'Gate', action: 'Action', monitor: 'Monitor', exit: 'Exit' };
  function detail(r) {
    var m = r.model, w = watch[r.slug], ck = checks[r.slug] || [], p = r.plan, cal = D.calibration.categories.filter(function (c) { return c.category === m.category_basis; })[0];
    var illus = calc.deposit * (r.implied_value_usd / Math.max(1, r.tvl_usd)) * calc.share / 100;
    var wf = [
      ['TVL (snapshot)', usd(r.tvl_usd), 'reported by DefiLlama'],
      isSize(m) ? ['= fitted base', usd(baseV(m, r.tvl_usd)), 'e^(' + m.a + ' + ' + m.b + '·ln TVL' + (m.offset ? ' ' + (m.offset > 0 ? '+ ' : '− ') + Math.abs(m.offset) : '') + ') = ' + m.multiple + '× TVL; fitted on ' + V.comps + ' traded tokens, held-out error ' + x3(VSEL.mdae_dex)]
        : ['× multiple', m.multiple + '×', esc(m.category_basis) + ': ' + (m.comps ? m.comps + ' traded comparables' + (cal && cal.examples.length ? ' (' + esc(cal.examples.slice(0, 3).join(', ')) + ')' : '') : 'all-category median')],
    ];
    if (isFx(m)) wf.push(['× growth (heuristic)', m.growth + '×', r.change_7d == null ? 'no 7-day change: neutral' : '7-day TVL ' + (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%, weight ' + M.growth_weight + ', clamped ' + M.growth_floor + '…+' + M.growth_cap + '%'],
      ['× listing age', m.track + '×', r.age_days == null ? 'no listing date' : r.age_days + ' days since DefiLlama listed it (proxy for time without a token)' + (r.age_days > M.fade_after_days ? '; fades past ' + M.fade_after_days + ' days' : '')],
      ['× chain breadth', m.breadth + '×', r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's')]);
    else wf.push(['7d growth, listing age', 'not in value', pct(r.change_7d) + ', ' + (r.age_days == null ? 'no date' : r.age_days + ' days (proxy)') + ': not in the fitted value' + (FXV ? ' (held out: ' + FXV.mdae_dex + ' dex with them vs ' + VSEL.mdae_dex + ' without)' : '') + '. Sensitivity: the fixed heuristics would give ×' + r4(growthF(r.change_7d) * trackF(r.age_days) * breadthF(r.chains.length)) + ' = ' + usd(implied(r, { fx: true }))]);
    wf.push(['× related token (heuristic)', m.sibling + '×', m.sibling < 1 ? 'a token-bearing protocol shares its name; untested judgement' : 'none found']);
    if (m.cls !== 1) wf.push(['× row class', m.cls + '×', esc(r.row_class) + ' (see status)']);
    var steps = p.steps.map(function (s) {
      return '<li class="k-' + s.kind + '"><div class="sh">' + pill(KIND[s.kind], 'k') + pill(esc(s.basis), s.basis === 'official source' ? 'os' : s.basis === 'assumption' ? 'as' : '') + '</div>' + esc(s.text) +
        '<div class="meta2">' + pill('Cost' + (s.cost === 'free' ? '' : ' (assumed)') + ': ' + esc(s.cost)) + pill('Time (assumed): ' + esc(s.time)) + '</div></li>';
    }).join('');
    var stat = function (l, v, d, c) { return '<div class="stat"><div class="l">' + l + '</div><div class="v' + (c ? ' ' + c : '') + '">' + v + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>'; };
    var left = '<div class="status"><b>Token status:</b> ' + esc(r.token_status) + ' · classification <b>' + esc(r.classification.certainty) + '</b>. ' + esc(r.classification.reason) + (r.flags.length ? '<br><b>Flags:</b> ' + r.flags.map(esc).join(' · ') : '') + '</div>' +
      '<div class="dgrid">' + stat('Implied value (estimate)', usd(r.implied_value_usd), 'range ' + range(r.implied_range_usd), 'hi') + stat('Opportunity', r.opportunity.toFixed(0) + '/100', 'value per $ TVL after risk & effort') + stat('Confidence', r.confidence, m.comps + ' comps · data gaps lower it', 'conf ' + r.confidence) + '</div>' +
      '<div class="dgrid four">' + stat('TVL', usd(r.tvl_usd)) + stat('7-day TVL', pct(r.change_7d)) + stat('Listed (proxy)', esc(r.listed_at || 'unknown')) + stat('Risk', r.risk.score + ' · ' + r.risk.level) + '</div>' +
      '<h3>How the value is built</h3><table class="wf">' + wf.map(function (x) { return '<tr><td>' + x[0] + '</td><td class="n num">' + x[1] + '</td><td class="note">' + x[2] + '</td></tr>'; }).join('') +
      '<tr class="tot"><td>= implied value</td><td class="n num">' + usd(r.implied_value_usd) + '</td><td>' + (implied(r) === r.implied_value_usd ? '<span class="ok">✓ recomputed in this page</span>' : '<span class="dn">recompute differs</span>') + '</td></tr></table>';
    var right = '<h3>Farm plan ' + pill(SRC(r) ? 'from official docs' : 'research checklist', SRC(r) ? 'os' : 'as') + '</h3><p class="note"><b>Product:</b> ' + esc(p.product) + ' <b>Access:</b> ' + esc(p.access) + '</p><ol class="plan">' + steps + '</ol>' +
      '<p class="note"><b>Assumptions, not requirements:</b> ' + p.assumptions.map(esc).join(' ') + '</p>' +
      (p.sources.length ? '<div class="srcs"><b>Sources read ' + esc(D.sources.retrieved) + ' (reference text, not links):</b>' + p.sources.map(function (s) { return '<div><code>' + esc(s.url) + '</code><br>Establishes: ' + esc(s.establishes) + ' <span class="mu">Not established: ' + esc(s.not_established) + '</span></div>'; }).join('') + '</div>' : '');
    return '<div class="dh"><div><div class="note">#' + r.rank + ' by implied value · ' + esc(r.category || 'Uncategorised') + (r.on_watchlist ? ' · house watchlist' : ' · not on the house watchlist') + '</div><h2>' + esc(r.name) + '</h2><div class="chips">' + chips(r, 8) + r.signals.map(function (s) { return '<span class="sig">' + esc(s) + '</span>'; }).join('') + '</div></div>' +
      '<div class="acts"><button class="btn' + (w ? ' pri' : '') + '" data-star="' + r.slug + '">' + (w ? '★ Starred' : '☆ Star') + '</button><button class="btn" data-cmpbtn="' + r.slug + '">' + (cmp.indexOf(r.slug) >= 0 ? '− Compare' : '+ Compare') + '</button><button class="btn" data-close="1" aria-label="Close">✕</button></div></div>' +
      '<div class="dcols"><div>' + left + '</div><div>' + right + '</div></div>' +
      '<div class="dcols sec"><div><h3>Risk ' + r.risk.score + '/100 · ' + r.risk.level + ' (heuristic)</h3><div class="bars">' + r.risk.parts.map(function (x) { return '<div><span title="' + esc(x[0]) + '">' + esc(x[0].length > 17 ? x[0].slice(0, 16) + '…' : x[0]) + '</span><span class="b bad" style="width:' + (x[1] * 2.5) + '%"></span><span class="num">+' + x[1] + '</span></div>'; }).join('') + '</div>' +
      '<h3 class="sec">Effort &amp; cost (assumed)</h3><div class="side">' + [['Effort', dots(r.effort.score)], ['Set-up time', r.effort.setup_min + ' min'], ['Upkeep', r.effort.weekly_min + ' min/week'], ['Review horizon', r.effort.hold_days + ' days'], ['Gas chain', esc(r.cost.chain || 'n/a')], ['Set-up gas', gas(r)], ['Test size', usd(r.cost.test_usd)]].map(function (x) { return '<div class="row"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div></div>' +
      '<div><div class="card"><h3>Illustrative arithmetic, not a forecast</h3><div class="calc"><label>Your deposit ($)<input type="number" min="0" step="100" id="c-dep" value="' + calc.deposit + '"></label><label>Share of the token to depositors (%)<input type="number" min="0" max="100" step="1" id="c-share" value="' + calc.share + '"></label></div>' +
      '<p class="note">If a token launched at the implied value and ' + calc.share + '% went pro-rata to TVL, $' + calc.deposit + ' would map to <b class="num hi">' + usd(illus) + '</b>, against ' + gas(r) + ' of assumed gas and ' + r.effort.hold_days + ' days of capital at risk. Many launches give depositors nothing; this is arithmetic on assumptions you set.</p></div>' +
      '<h3 class="sec">Research checklist (saved in this browser)</h3><div class="check">' + r.research.map(function (t, i) { return '<label><input type="checkbox" data-check="' + r.slug + '" data-i="' + i + '"' + (ck.indexOf(i) >= 0 ? ' checked' : '') + '><span>' + esc(t) + '</span></label>'; }).join('') + '</div>' +
      '<h3 class="sec">My notes</h3>' + (w ? statusSel(r.slug, w) + ' <textarea data-note="' + r.slug + '" placeholder="Wallet, dates, what you did">' + esc(w.note || '') + '</textarea>' : '<p class="note">Star this protocol to keep a status and notes for it.</p>') + '</div></div>';
  }
  function statusSel(slug, w) { return '<select data-status="' + slug + '">' + ['Researching', 'Farming', 'Paused', 'Exited'].map(function (s) { return '<option' + (w.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>'; }
  function openDetail(slug) {
    var r = BY[slug]; if (!r) { S.p = ''; return closeDetail(); }
    S.p = slug; $('drawer').innerHTML = detail(r); $('drawer').classList.add('on'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').classList.add('on'); writeHash();
  }
  function closeDetail() { $('drawer').classList.remove('on'); $('drawer').setAttribute('aria-hidden', 'true'); $('scrim').classList.remove('on'); if (S.p) { S.p = ''; writeHash(); render(); } }

  // ---- compare
  function compare() {
    if (!cmp.length) return '<div class="empty">Tick ⇄ on up to 4 rows (or “+ Compare” in a detail view) to compare them.</div>';
    var rs = cmp.map(function (s) { return BY[s]; });
    var lines = [
      ['Rank', function (r) { return '#' + r.rank; }], ['Category', function (r) { return esc(r.category || 'Uncategorised'); }], ['Implied value', function (r) { return '<b class="hi">' + usd(r.implied_value_usd) + '</b>'; }],
      ['Range', function (r) { return range(r.implied_range_usd); }], ['Confidence', function (r) { return conf(r.confidence); }], ['Opportunity', function (r) { return r.opportunity.toFixed(0); }],
      ['TVL', function (r) { return usd(r.tvl_usd); }], ['7-day TVL', function (r) { return pct(r.change_7d); }], ['Listed', function (r) { return age(r.age_days); }],
      ['Multiple', function (r) { return r.model.multiple + '× (' + r.model.comps + ' comps)'; }], ['Growth × age × breadth', function (r) { return r.model.growth + ' × ' + r.model.track + ' × ' + r.model.breadth; }],
      ['Related-token factor', function (r) { return r.model.sibling; }], ['Classification', function (r) { return esc(r.classification.certainty) + ' · ' + esc(r.row_class); }],
      ['Risk', function (r) { return risk(r) + ' ' + r.risk.level; }],
      ['Effort', function (r) { return dots(r.effort.score); }], ['Set-up gas (assumed)', function (r) { return gas(r) + ' on ' + esc(r.cost.chain || 'n/a'); }],
      ['Plan', function (r) { return SRC(r) ? 'official docs' : 'research checklist'; }], ['Product', function (r) { return esc(r.plan.product); }],
      ['Flags', function (r) { return r.flags.length ? r.flags.map(esc).join('<br>') : '<span class="mu">none</span>'; }],
    ];
    return tbl('<th></th>' + rs.map(function (r) { return '<th><span data-open="' + r.slug + '" class="lnk">' + esc(r.name) + '</span> <button class="star" data-cmpbtn="' + r.slug + '" title="Remove">✕</button></th>'; }).join(''),
      lines.map(function (l) { return '<tr><td class="mu">' + l[0] + '</td>' + rs.map(function (r) { return '<td>' + l[1](r) + '</td>'; }).join('') + '</tr>'; }).join(''), 'cmp');
  }

  // ---- my watchlist
  function myWatch() {
    var ks = Object.keys(watch).filter(function (s) { return BY[s]; });
    var tools = '<div class="view-tools"><button class="btn" data-export="1">Export JSON</button><label class="btn">Import JSON<input type="file" id="imp" accept=".json,application/json" class="hidden"></label>' + (ks.length ? '<button class="btn" data-clear="1">Clear all</button>' : '') + '<span class="note">Stored only in this browser (localStorage); nothing leaves the page.</span></div>';
    if (!ks.length) return tools + '<div class="empty">Star protocols on the board (★) to track them here with a status and notes.</div>';
    return tools + tbl(ths(['★', 'Rank', 'Protocol', 'Implied value', 'Risk', 'Status', 'Checklist', 'Note', 'Starred']), ks.map(function (s) { return BY[s]; }).sort(function (a, b) { return a.rank - b.rank; }).map(function (r) {
      var w = watch[r.slug];
      return '<tr data-open="' + r.slug + '"><td><button class="star on" data-star="' + r.slug + '">★</button></td><td>' + r.rank + '</td><td class="name">' + esc(r.name) + '<small>' + esc(r.category || '') + '</small></td><td>' + usd(r.implied_value_usd) + '</td><td>' + risk(r) + '</td>' +
        '<td>' + statusSel(r.slug, w) + '</td><td>' + (checks[r.slug] || []).length + '/' + r.research.length + '</td><td class="note">' + esc((w.note || '').slice(0, 60)) + '</td><td class="note">' + esc(w.added || '') + '</td></tr>';
    }).join(''));
  }

  // ---- value model and scenario
  var scen = { gw: M.growth_weight, sib: M.sibling_factor, fx: false };
  function scenRows() {
    return ROWS.map(function (r) { return { r: r, v: implied(r, scen) }; }).sort(function (a, b) { return b.v - a.v || a.r.rank - b.r.rank; }).slice(0, 15).map(function (x, i) {
      var d = x.r.rank - (i + 1); return '<tr data-open="' + x.r.slug + '"><td>' + (i + 1) + '</td><td>' + esc(x.r.name) + '</td><td class="n">' + usd(x.v) + '</td><td class="n">#' + x.r.rank + '</td><td class="n ' + (d > 0 ? 'up' : d < 0 ? 'dn' : 'mu') + '">' + (d > 0 ? '▲' + d : d < 0 ? '▼' + (-d) : '=') + '</td></tr>';
    }).join('');
  }
  function vtable(short) {
    var rs = short ? V.results.filter(function (x) { return ['global', 'category', 'size', 'size+factors', V.selected].indexOf(x.id) >= 0; }) : V.results;
    return tbl(ths(short ? ['Mapping (held out)', 'Median error', 'Within ×3'] : ['Mapping', 'Tokens', 'Median error (dex)', 'Mean', 'Within ×3', 'Per fold']), rs.map(function (x) {
      return '<tr' + (x.id === V.selected ? ' class="sel"' : '') + '><td>' + esc(x.label) + (x.id === V.selected ? ' <b>✓ used</b>' : '') + '</td>' + (short ? '' : '<td class="n">' + x.n + '</td>') + '<td class="n">' + x.mdae_dex + (short ? ' (' + x3(x.mdae_dex) + ')' : '') + '</td>' + (short ? '' : '<td class="n">' + x.mae_dex + '</td>') + '<td class="n">' + Math.round(x.within_3x * 100) + '%</td>' + (short ? '' : '<td class="note">' + x.folds.join(' / ') + '</td>') + '</tr>';
    }).join(''));
  }

  function model() {
    var g = D.calibration.global;
    var form = isSize({ mapping: V.selected }) ? 'base = e^(a + b·ln TVL' + (V.selected === 'size+category' ? ' + category offset' : '') + ')   a = ' + V.full_fit.a + ', b = ' + V.full_fit.b + ', fitted on all ' + V.comps + ' traded tokens' : 'base = TVL × ' + (V.selected === 'global' ? 'all-category multiple ' + g.multiple + '×' : 'shrunk category multiple (table below)');
    return '<div class="card"><h3>Held-out check on traded tokens</h3>' + vtable() + '<p class="note">' + V.folds + ' folds by slug hash (sizes ' + V.fold_sizes.join(', ') + '), all fits redone without the held-out fold. Error: median |log10(predicted ÷ actual mcap)|; 0.30 dex = ×2. Growth, age and breadth are fixed heuristics. The same folds chose the mapping, so its error is slightly optimistic. Selected: ' + esc(V.reason) + '.</p></div>' +
      '<div class="two"><div class="card"><h3>The formula used</h3><div class="formula">' + form + '\n  × related = ' + M.sibling_factor + ' if a token-bearing protocol shares the first word of its name (heuristic, untested)\n  × class   = 0.3 for weak rows (heuristic)' + (isFx({ mapping: V.selected }) ? '\n  × growth × age × breadth (fixed heuristics)' : '') + '\nrange = ×/÷ e^(held-out error), widened per missing field</div>' +
''+
      '<p class="note"><b>Listing age</b> uses DefiLlama\'s listing date as a proxy for time without a token, not a launch date. <b>Value</b> is the estimate, <b>opportunity</b> ranks value per $ TVL after risk and effort, <b>confidence</b> grades its evidence.</p>' +
      '<p class="note"><b>What it does not know:</b> supply, unlocks, team intent, points programmes, funding or prices. It says what a token could be worth if the record held, not whether or when one launches.</p><p class="ok">✓ ' + verified + '/' + ROWS.length + ' implied values recomputed in this page match board.json.</p></div>' +
      '<div class="card"><h3>Scenario: change the weights</h3><div class="calc"><label>Growth weight: <b id="sv-gw">' + scen.gw + '</b><input type="range" min="0" max="1.5" step="0.1" value="' + scen.gw + '" data-scen="gw"></label><label>Related-token factor: <b id="sv-sib">' + scen.sib + '</b><input type="range" min="0.2" max="1" step="0.1" value="' + scen.sib + '" data-scen="sib"></label></div>' +
      '<label class="note"><input type="checkbox" data-scen="fx"' + (scen.fx ? ' checked' : '') + '> add the growth, age and breadth heuristics (weight above)</label><p class="note">A what-if; the board keeps the model\'s stated ranks. Top 15 under this scenario:</p>' +
      '<table><thead><tr>' + ths(['#', 'Protocol', 'Scenario value', 'Board', 'Move']) + '</tr></thead><tbody id="scen-body">' + scenRows() + '</tbody></table></div></div>' +
      '<div class="card"><h3>Category multiples measured on this snapshot' + (V.selected.indexOf('category') < 0 ? ' (reference; not used by the selected mapping)' : '') + '</h3>' + tbl(ths(['Category', 'Traded comps', 'Raw median', 'Used multiple', 'IQR ±(log)', 'Largest comparables', 'Board rows']), D.calibration.categories.map(function (c) {
        return '<tr><td>' + esc(c.category) + '</td><td class="n">' + c.comps + '</td><td class="n">' + c.raw_median + '×</td><td class="n"><b>' + c.multiple + '×</b></td><td class="n">' + c.spread + '</td><td class="note">' + esc(c.examples.join(', ')) + '</td><td class="n">' + ROWS.filter(function (r) { return r.model.category_basis === c.category; }).length + '</td></tr>';
      }).join('')) + '</div>';
  }

  // ---- set aside and traded tokens: the other side of the separation
  function aside() {
    var tr = function (cells) { return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; };
    return '<div class="two"><div class="card"><h3>No token recorded, but set aside (' + D.set_aside_total + ')</h3><p class="note">Bridges, exchanges, liquid staking/restaking, versioned and wrapped products: usually a product of a token that already trades, so not ranked unless a snapshot is too small (then labelled weak).</p>' +
      tbl(ths(['Protocol', 'Category', 'TVL', 'Reason']), D.set_aside.slice(0, 60).map(function (p) { return tr([esc(p.name), esc(p.category || ''), usd(p.tvl_usd), esc(p.reason)]); }).join('')) +
      (D.set_aside_total > 60 ? '<p class="note">… and ' + (D.set_aside_total - 60) + ' smaller ones.</p>' : '') + '</div>' +
      '<div class="card"><h3>Token already trades (' + D.live_total + ') · value comparables</h3><p class="note">Market cap and TVL as recorded; these set the multiples and are never ranked.</p>' +
      tbl(ths(['Protocol', 'Ticker', 'Category', 'Mcap', 'TVL', 'Mcap/TVL']), D.live.slice(0, 40).map(function (p) { return tr([esc(p.name), esc(p.symbol || ''), esc(p.category || ''), usd(p.mcap_usd), usd(p.tvl_usd), p.ratio + '×']); }).join('')) +
      '<h3 class="sec">Token recorded, no market cap (' + D.unpriced_total + ')</h3><p class="note">DefiLlama names a ticker or CoinGecko id but no market cap: a token likely exists, so these are not ranked.</p>' +
      tbl(ths(['Protocol', 'Ticker / id', 'TVL']), D.unpriced.slice(0, 20).map(function (p) { return tr([esc(p.name), esc(p.symbol || p.gecko_id || ''), usd(p.tvl_usd)]); }).join('')) + '</div></div>';
  }

  // ---- render and events
  function render() {
    syncControls();
    $('view').innerHTML = ({ board: board, map: map, compare: compare, watch: myWatch, model: model, aside: aside }[S.tab] || board)();
    if (S.p && BY[S.p]) openDetail(S.p); else { $('drawer').classList.remove('on'); $('scrim').classList.remove('on'); }
    writeHash();
  }
  function toggleStar(slug) { if (watch[slug]) delete watch[slug]; else watch[slug] = { status: 'Researching', note: '', added: new Date().toISOString().slice(0, 10) }; save('watch', watch); }
  function toggleCmp(slug, on) {
    var i = cmp.indexOf(slug); if (on === undefined) on = i < 0;
    if (on && i < 0) { if (cmp.length >= 4) cmp.shift(); cmp.push(slug); } else if (!on && i >= 0) cmp.splice(i, 1);
    save('compare', cmp);
  }
  function resetFilters() { ['q', 'cat', 'chain', 'set', 'risk', 'conf', 'tvl', 'effort', 'sort', 'dir'].forEach(function (k) { S[k] = DEF[k]; }); limit = 60; render(); }
  document.addEventListener('click', function (e) {
    var t = e.target, a;
    if ((a = t.closest('[data-tab]'))) { S.tab = a.dataset.tab; S.p = ''; limit = 60; return render(); }
    if ((a = t.closest('[data-star]'))) { e.stopPropagation(); toggleStar(a.dataset.star); return render(); }
    if ((a = t.closest('[data-cmpbtn]'))) { e.stopPropagation(); toggleCmp(a.dataset.cmpbtn); return render(); }
    if (t.matches('[data-cmp]')) { e.stopPropagation(); toggleCmp(t.dataset.cmp, t.checked); return syncControls(); }
    if (t.closest('[data-close]') || t === $('scrim')) return closeDetail();
    if ((a = t.closest('th[data-sort]'))) { var k = a.dataset.sort; S.dir = S.sort === k ? -S.dir : 1; S.sort = k; return render(); }
    if (t.closest('[data-more]')) { limit += 60; return render(); }
    if (t.closest('[data-reset]')) return resetFilters();
    if (t.closest('[data-export]')) {
      var l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([JSON.stringify({ format: 'token-radar-watchlist/1', snapshot: D.as_of, watch: watch, checks: checks }, null, 2)], { type: 'application/json' }));
      l.download = 'token-radar-watchlist-' + D.as_of + '.json'; document.body.appendChild(l); l.click(); l.remove(); return;
    }
    if (t.closest('[data-clear]')) { if (confirm('Remove every starred protocol, note and checklist?')) { watch = {}; checks = {}; save('watch', watch); save('checks', checks); render(); } return; }
    if (t.closest('input,select,textarea,label')) return;
    if ((a = t.closest('[data-open]'))) { openDetail(a.dataset.open); $('view').querySelectorAll('tr.sel').forEach(function (x) { x.classList.remove('sel'); }); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.check) { var c = (checks[t.dataset.check] || []).filter(function (x) { return x !== +t.dataset.i; }); if (t.checked) c.push(+t.dataset.i); checks[t.dataset.check] = c; save('checks', checks); return; }
    if (t.dataset.status && watch[t.dataset.status]) { watch[t.dataset.status].status = t.value; save('watch', watch); return; }
    if (t.id === 'imp' && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () { try { var o = JSON.parse(fr.result); Object.assign(watch, o.watch || {}); Object.assign(checks, o.checks || {}); save('watch', watch); save('checks', checks); render(); } catch (err) { alert('That file is not a Token Radar watchlist export.'); } };
      return fr.readAsText(t.files[0]);
    }
    if (t.dataset.scen === 'fx') { scen.fx = t.checked; $('scen-body').innerHTML = scenRows(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.note && watch[t.dataset.note]) { watch[t.dataset.note].note = t.value; return save('watch', watch); }
    if (t.id === 'c-dep' || t.id === 'c-share') { calc.deposit = Math.max(0, +$('c-dep').value || 0); calc.share = clamp(+$('c-share').value || 0, 0, 100); save('calc', calc); var id = t.id, pos = t.selectionStart; openDetail(S.p); var n = $(id); n.focus(); try { n.setSelectionRange(pos, pos); } catch (err) { /* number inputs */ } return; }
    if (t.dataset.scen && t.type === 'range') { scen[t.dataset.scen] = +t.value; $('sv-' + t.dataset.scen).textContent = t.value; $('scen-body').innerHTML = scenRows(); }
  });
  ['q', 'cat', 'chain', 'set', 'risk', 'conf', 'tvl', 'effort'].forEach(function (k) {
    $('f-' + k).addEventListener(k === 'q' ? 'input' : 'change', function () { S[k] = k === 'tvl' || k === 'effort' ? +this.value : this.value; limit = 60; render(); });
  });
  $('f-reset').addEventListener('click', resetFilters);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.p) closeDetail(); });
  window.addEventListener('hashchange', function () { readHash(); render(); });

  readHash(); header(); render();
})();
