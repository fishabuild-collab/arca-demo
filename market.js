(function () {
  'use strict';
  var charts = [];
  var explainOpen = false;

  function css(name, fb) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fb;
    } catch (e) { return fb; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtHKD(n) { try { return Arca.fmtHKD(n); } catch (e) { return 'HK$' + Number(n).toLocaleString('en-US'); } }
  function fmtPsf(n) { try { return Arca.fmtPsf(n); } catch (e) { return 'HK$' + Number(n).toLocaleString('en-US') + '/sq ft'; } }
  function role() { return (window.Arca && Arca.state && Arca.state.role) || 'Investment Team'; }

  function destroy() {
    charts.forEach(function (c) { try { c.destroy(); } catch (e) {} });
    charts = [];
  }

  function insight(d) {
    var deal = d.deal || {};
    var comps = (d.comps || []).filter(function (c) { return !c.hero && c.psf && c.area; });
    var latest = comps[0];
    comps.forEach(function (c) { if ((c.date || '') > (latest.date || '')) latest = c; });
    if (!latest || !deal.price_per_sqft) return 'Comparable data is not available yet.';
    var gap = (deal.price_per_sqft - latest.psf) / latest.psf * 100;
    var dir = gap < 0 ? 'below' : 'above';
    return 'The hero unit sold at ' + fmtPsf(deal.price_per_sqft) + ', ' + Math.abs(Math.round(gap)) +
      '% ' + dir + ' the latest comparable (' + esc(latest.label) + ', ' + fmtPsf(latest.psf) + ').';
  }

  function render() {
    try {
      var root = document.getElementById('tab-market');
      if (!root) return;
      destroy();
      var d = (window.Arca && Arca.data) || {};
      var demo = !!(Arca.state && Arca.state.demoMode);

      var html = '<div style="max-width:960px;padding:0 0 48px">' +
        '<div style="font-size:28px;font-weight:400;color:var(--text);line-height:1.2">Market</div>';

      if (role() === 'External Buyer') {
        html += '<div style="margin-top:16px">' + labelHtml('Not shared', 'neutral') + '</div>' +
          '<div style="font-size:16px;color:var(--muted);margin-top:12px">Pricing analysis is not shared with your role.</div></div>';
        root.innerHTML = html;
        return;
      }

      html += '<div style="font-size:16px;color:var(--muted);margin-top:8px">' + insight(d) + '</div>' +
        '<div style="border-top:1px solid var(--line);margin-top:24px;padding-top:24px">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Price per sq ft vs saleable area</div>' +
        '<div style="position:relative;height:320px"><canvas id="mk-scatter"></canvas></div></div>' +
        '<div style="border-top:1px solid var(--line);margin-top:24px;padding-top:24px">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Super-prime comparables, price per sq ft</div>' +
        '<div style="position:relative;height:240px"><canvas id="mk-bar"></canvas></div></div>' +
        '<div id="mk-price" style="border-top:1px solid var(--line);margin-top:24px;padding-top:24px"></div></div>';
      root.innerHTML = html;

      drawCharts(d);
      renderPrice(d, demo);
    } catch (e) { try { console.warn('market render', e); } catch (_) {} }
  }

  function labelHtml(t, tone) {
    try { return Arca.label(t, tone); } catch (e) { return esc(t); }
  }

  function drawCharts(d) {
    if (typeof Chart === 'undefined') return;
    var gold = css('--gold', '#0059C8'), line = css('--line', '#E1E6EB'),
      muted = css('--muted', '#5B6474'), text = css('--text', '#111B2B');
    var deal = d.deal || {};
    var comps = (d.comps || []).filter(function (c) { return !c.hero && c.psf && c.area; })
      .map(function (c) { return { x: c.area, y: c.psf, label: c.label }; });
    var hero = [{ x: deal.saleable_area_sqft, y: deal.price_per_sqft, label: 'Hero unit' }];
    var tick = { color: muted, font: { size: 12, family: 'Inter, sans-serif' } };
    var tip = {
      callbacks: {
        label: function (c) { var r = c.raw || {}; return (r.label || '') + ': ' + fmtPsf(r.y) + ', ' + r.x + ' sq ft'; }
      }
    };
    try {
      charts.push(new Chart(document.getElementById('mk-scatter'), {
        type: 'scatter',
        data: {
          datasets: [
            { label: 'Comparables', data: comps, backgroundColor: '#9AA4B2', borderColor: '#9AA4B2', pointRadius: 6 },
            { label: 'Hero unit', data: hero, backgroundColor: gold, borderColor: gold, pointRadius: 9 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
          plugins: { legend: { labels: { color: muted, boxWidth: 10, font: { size: 12 } } }, tooltip: tip },
          scales: {
            x: { title: { display: true, text: 'Saleable area (sq ft)', color: muted, font: { size: 12 } }, grid: { color: line }, ticks: tick },
            y: { title: { display: true, text: 'HK$ per sq ft', color: muted, font: { size: 12 } }, grid: { color: line }, ticks: tick }
          }
        }
      }));
    } catch (e) {}
    try {
      var sp = d.super_prime || [];
      charts.push(new Chart(document.getElementById('mk-bar'), {
        type: 'bar',
        data: {
          labels: sp.map(function (s) { return s.project; }),
          datasets: [{ label: 'HK$ per sq ft', data: sp.map(function (s) { return s.psf; }), backgroundColor: '#9AA4B2', borderWidth: 0 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return fmtPsf(c.raw); } } } },
          scales: {
            x: { grid: { display: false }, ticks: tick },
            y: { grid: { color: line }, ticks: tick }
          }
        }
      }));
    } catch (e) {}
  }

  function fallbackRec(d) {
    return (d.cached_ai && d.cached_ai.pricing_recommendation) || null;
  }

  function renderPrice(d, demo) {
    var el = document.getElementById('mk-price');
    if (!el) return;
    var rec = fallbackRec(d);
    var by = 'cached';
    if (!demo && rec && rec.processed_by) by = rec.processed_by;
    if (!rec) {
      el.innerHTML = '<div style="font-size:12px;color:var(--muted)">Suggested next-batch price range</div>' +
        '<div style="font-size:16px;color:var(--muted);margin-top:8px">No recommendation available.</div>';
      return;
    }
    var r = rec.range_psf || [];
    var bullets = (rec.reasoning || []).map(function (b) {
      return '<li style="margin-bottom:8px">' + esc(b) + '</li>';
    }).join('');
    var used = (d.comps || []).filter(function (c) { return c.psf; }).map(function (c) {
      return esc(c.label) + ' (' + fmtPsf(c.psf) + ')';
    }).join('; ');
    var badge = '';
    try { badge = Arca.badge(by); } catch (e) { badge = esc(by); }
    el.innerHTML =
      '<div style="font-size:12px;color:var(--muted)">Suggested next-batch price range</div>' +
      '<div style="font-size:20px;color:var(--text);margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<span>' + fmtPsf(r[0]) + ' to ' + fmtPsf(r[1]) + '</span>' + badge +
      '<a href="#" id="mk-explain" style="font-size:14px;color:var(--blue);text-decoration:none">Explain</a></div>' +
      '<div id="mk-why" style="display:' + (explainOpen ? 'block' : 'none') + ';margin-top:16px;font-size:14px;color:var(--text)">' +
      '<ul style="margin:0;padding-left:20px">' + bullets + '</ul>' +
      '<div style="font-size:12px;color:var(--muted);margin-top:12px">Data points used: ' + used + '</div></div>';
    var a = document.getElementById('mk-explain');
    if (a) a.addEventListener('click', function (ev) {
      try {
        ev.preventDefault();
        explainOpen = !explainOpen;
        var w = document.getElementById('mk-why');
        if (w) w.style.display = explainOpen ? 'block' : 'none';
      } catch (e) {}
    });
  }

  function init() {
    try {
      render();
      Arca.on('role:changed', render);
      Arca.on('demo:toggle', render);
    } catch (e) {}
  }

  try {
    if (window.Arca && Arca.data) init();
    else if (window.Arca && Arca.on) Arca.on('ready', init);
    else window.addEventListener('load', function () { if (window.Arca && Arca.on) Arca.on('ready', init); });
  } catch (e) {}
})();
