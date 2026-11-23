/* Token Launch Radar — the board, the detail view and the trading set, from window.RADAR.
   Plain script, no imports, no network: every figure on the page comes from data.js. */
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtPct(n) {
    if (n == null) return '<span class="chains">n/a</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function fmtAge(days) {
    if (days == null) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }
  function bySlug(slug) {
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i];
    return null;
  }

  /* Masthead stats */
  document.getElementById('mast-stats').innerHTML = [
    [R.board_size, 'protocols ranked'],
    [R.watchlist_size + ' / ' + R.watchlist_size, 'watchlist covered'],
    [R.early_size, 'early finds below the floor'],
    [esc(R.as_of), 'snapshot date'],
  ].map(function (s) { return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>'; }).join('');
  document.getElementById('foot-source').textContent = 'Data: ' + R.source + ' · Model ' + R.model_version + ' · The board is regenerated from the sealed snapshot by the entry program; this page adds nothing to it.';

  var state = { view: 'board', q: '', category: '', chain: '', sort: 'rank', wl: false, np: false, slug: null };

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('?');
    var path = parts[0];
    var params = new URLSearchParams(parts[1] || '');
    state = { view: 'board', q: params.get('q') || '', category: params.get('category') || '', chain: params.get('chain') || '', sort: params.get('sort') || 'rank', wl: params.get('wl') === '1', np: params.get('np') === '1', slug: null };
    if (path.indexOf('p/') === 0) { state.view = 'detail'; state.slug = decodeURIComponent(path.slice(2)); }
    else if (path === 'live') state.view = 'live';
  }

  function methodHtml() {
    return '<section class="method"><h2>How this board prices a launch that has not happened</h2><ol>' +
      '<li><b>Peer multiple.</b> Each category of already-trading protocols gives a median market-cap / TVL; a pre-token protocol inherits its own category\u2019s, shrunk toward the global median of ' + R.global_multiple.toFixed(2) + '\u00d7 when peers are few, with single ratios winsorized so one outlier prices nobody.</li>' +
      '<li><b>Momentum.</b> The 7-day TVL change tilts the peer value by up to \u00b130%: money flowing in is worth more than the same TVL standing still.</li>' +
      '<li><b>Track record.</b> Years of held TVL with no token count for up to +28%: a launch is likelier to be priced seriously from a protocol that has already lasted.</li>' +
      '<li><b>Product honesty.</b> Wrapped, staked and bridged products of assets that already trade are flagged and cut to a fifth: their value accrues to the parent asset, not to a launch of their own.</li>' +
      '</ol><p class="formula">implied = TVL \u00d7 peer multiple \u00d7 momentum \u00d7 track record \u00d7 footprint \u00d7 product factor \u00b7 every factor is printed on each protocol\u2019s detail page</p></section>';
  }

  function options(values, current, allLabel) {
    var out = '<option value="">' + allLabel + '</option>';
    values.forEach(function (v) { out += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>'; });
    return out;
  }

  function controlsHtml(count, total) {
    var cats = [], chains = [], seenC = {}, seenH = {};
    R.rows.forEach(function (r) {
      if (r.category && !seenC[r.category]) { seenC[r.category] = 1; cats.push(r.category); }
      r.chains.forEach(function (c) { if (!seenH[c]) { seenH[c] = 1; chains.push(c); } });
    });
    cats.sort(); chains.sort();
    return '<div class="controls">' +
      '<span class="seg" role="group" aria-label="View">' +
      '<button id="v-board" aria-pressed="' + (state.view === 'board') + '">Launch board</button>' +
      '<button id="v-live" aria-pressed="' + (state.view === 'live') + '">Already trading</button></span>' +
      '<input type="search" id="f-q" placeholder="Search protocols\u2026" value="' + esc(state.q) + '">' +
      '<select id="f-cat" aria-label="Category">' + options(cats, state.category, 'All categories') + '</select>' +
      '<select id="f-chain" aria-label="Chain">' + options(chains, state.chain, 'All chains') + '</select>' +
      '<select id="f-sort" aria-label="Sort by">' +
      [['rank', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['change', 'Sort: 7d change'], ['age', 'Sort: track record'], ['ready', 'Sort: readiness']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select>' +
      '<label class="chk"><input type="checkbox" id="f-wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<label class="chk"><input type="checkbox" id="f-np"' + (state.np ? ' checked' : '') + '> Hide wrapped / staked products</label>' +
      '<span class="count">' + count + ' of ' + total + ' rows</span></div>';
  }

  function filteredRows() {
    var rows = R.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.np && r.product) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q && r.name.toLowerCase().indexOf(state.q.toLowerCase()) < 0 && r.slug.indexOf(state.q.toLowerCase()) < 0) return false;
      return true;
    });
    var key = { rank: 'rank', tvl: 'tvl_usd', change: 'change_7d', age: 'age_days', ready: 'readiness' }[state.sort];
    rows.sort(function (a, b) { return (b[key] == null ? -1e18 : b[key]) - (a[key] == null ? -1e18 : a[key]) || a.rank - b.rank; });
    if (state.sort === 'rank') rows.sort(function (a, b) { return a.rank - b.rank; });
    return rows;
  }

  function badges(r) {
    var out = '';
    if (r.on_watchlist) out += '<span class="badge wl">Watchlist</span>';
    if (r.product) out += '<span class="badge prod">Wrapped / staked product</span>';
    return out;
  }

  function boardHtml() {
    var rows = filteredRows();
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badges(r) + '<br><span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + r.model.peer_multiple.toFixed(2) + '\u00d7</td>' +
        '<td class="num impl">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td><span class="ready"><i style="width:' + r.readiness + '%"></i></span><span class="ready-num">' + r.readiness + '</span></td></tr>';
    }).join('');
    if (!rows.length) body = '<tr><td colspan="9"><div class="empty">No protocol matches these filters. Loosen one and the radar sweeps again.</div></td></tr>';
    return methodHtml() + controlsHtml(rows.length, R.rows.length) +
      '<div class="board-wrap"><table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Peer \u00d7</th><th class="num">Implied value</th><th>Readiness</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function liveHtml() {
    var body = R.live.map(function (r) {
      return '<tr><td><span class="pname">' + esc(r.name) + '</span> <span class="pcat">' + esc(r.symbol || '') + '</span><br><span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.multiple == null ? '—' : r.multiple.toFixed(2) + '\u00d7') + '</td></tr>';
    }).join('');
    return '<section class="method"><h2>Already trading — the evidence, not the board</h2><ol><li><b>These protocols have a token.</b> They are never ranked: the market has already given its answer. Their market-cap / TVL ratios are the peer evidence the launch board prices from, category by category.</li></ol></section>' +
      controlsHtml(R.live.length, R.live.length) +
      '<div class="board-wrap"><table class="board"><thead><tr><th>Protocol</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function detailHtml(r) {
    var m = r.model;
    var cells = [
      ['Implied value', fmtUsd(r.implied_value_usd)],
      ['TVL', fmtUsd(r.tvl_usd)],
      ['7d TVL change', r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'],
      ['Track record', fmtAge(r.age_days)],
      ['Readiness', r.readiness + ' / 100'],
      ['Model confidence', r.confidence],
    ].map(function (c) { return '<div class="cell"><span>' + c[0] + '</span><b>' + c[1] + '</b></div>'; }).join('');
    var rows = [
      ['TVL (snapshot)', fmtUsd(r.tvl_usd)],
      ['Peer multiple — ' + esc(r.category || 'all categories') + ', ' + m.peer_count + ' trading peer' + (m.peer_count === 1 ? '' : 's'), '\u00d7 ' + m.peer_multiple.toFixed(2)],
      ['Momentum — 7d change ' + (r.change_7d == null ? 'unreported, counted neutral' : r.change_7d.toFixed(1) + '%'), '\u00d7 ' + m.momentum_factor.toFixed(2)],
      ['Track record — ' + fmtAge(r.age_days) + ' with no token', '\u00d7 ' + m.track_factor.toFixed(2)],
      ['Footprint — ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), '\u00d7 ' + m.footprint_factor.toFixed(2)],
    ];
    if (r.product) rows.push(['Product factor — wrapped / staked product of a trading asset', '\u00d7 ' + m.product_factor.toFixed(2)]);
    var breakdown = rows.map(function (x) { return '<tr><td>' + x[0] + '</td><td class="num">' + x[1] + '</td></tr>'; }).join('') +
      '<tr class="total"><td>Implied value if it launched at these prices</td><td class="num">' + fmtUsd(r.implied_value_usd) + '</td></tr>';
    var plan = r.farm_plan.map(function (s) {
      return '<li><span class="act">' + esc(s.action) + '</span><span class="chips"><span class="chip">Cost <b>' + esc(s.cost) + '</b></span><span class="chip">Time <b>' + esc(s.time) + '</b></span></span></li>';
    }).join('');
    var note = r.product
      ? '<p class="note">This record is a wrapped, staked or bridged product of an asset whose token already trades. The board keeps it visible and flagged rather than pretending it is a launch candidate: any value a program attached to it would most likely arrive through the parent asset, and its implied value is cut to a fifth for exactly that reason.</p>'
      : (r.on_watchlist
        ? '<p class="note">On the snapshot\u2019s watchlist: at or above the $50M floor, recording no token, and not a wrapped or staked product of one that trades. The board ranks it on the same formula as every other row — no hand-tuning.</p>'
        : '<p class="note">An early find: below the watchlist\u2019s $50M floor, which is a floor and never a ceiling. The radar exists to surface rows like this one while they are still cheap to farm.</p>');
    return '<a class="back" href="#/board">\u2190 Back to the board</a><section class="detail">' +
      '<h2>' + esc(r.name) + badges(r) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + R.board_size + ' \u00b7 ' + esc(r.category || 'Uncategorised') + ' \u00b7 ' + esc(r.chains.join(', ') || 'no chains recorded') + ' \u00b7 tracked since ' + esc(r.listed_at || 'an unrecorded date') + '</p>' +
      '<div class="dgrid">' + cells + '</div>' + note +
      '<h3>How the implied value is built</h3><table class="breakdown">' + breakdown + '</table>' +
      '<h3>The farm plan</h3><ol class="plan">' + plan + '</ol></section>';
  }

  function setHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.chain) p.set('chain', state.chain);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.wl) p.set('wl', '1');
    if (state.np) p.set('np', '1');
    var qs = p.toString();
    var target = '#/board' + (qs ? '?' + qs : '');
    if (location.hash !== target) history.replaceState(null, '', target);
  }

  function bind() {
    var vb = document.getElementById('v-board'), vl = document.getElementById('v-live');
    if (vb) vb.addEventListener('click', function () { location.hash = '#/board'; });
    if (vl) vl.addEventListener('click', function () { location.hash = '#/live'; });
    var q = document.getElementById('f-q');
    if (q) q.addEventListener('input', function () { state.q = q.value; setHash(); render(false); var nq = document.getElementById('f-q'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
    [['f-cat', 'category'], ['f-chain', 'chain'], ['f-sort', 'sort']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) el.addEventListener('change', function () { state[pair[1]] = el.value; setHash(); render(false); });
    });
    [['f-wl', 'wl'], ['f-np', 'np']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) el.addEventListener('change', function () { state[pair[1]] = el.checked; setHash(); render(false); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug')); });
    });
  }

  function render(reparse) {
    if (reparse !== false) parseHash();
    if (state.view === 'detail') {
      var r = bySlug(state.slug);
      app.innerHTML = r ? detailHtml(r) : boardHtml();
    } else if (state.view === 'live') {
      app.innerHTML = liveHtml();
    } else {
      app.innerHTML = boardHtml();
    }
    app.setAttribute('aria-busy', 'false');
    bind();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', function () { render(true); });
  render(true);
})();
