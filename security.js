/* Arca security.js: Security tab + Activity feed. Never throws. */
(function () {
  'use strict';
  var A = window.Arca = window.Arca || {};
  var ROLES = ['Investment Team', 'Lawyer', 'Banker', 'External Buyer'];
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var safe = function (fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { try { console.warn('security.js', e); } catch (_) {} } }; };
  var api = function (p, o) { try { return Promise.resolve(A.api ? A.api(p, o) : null).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); } };
  var label = function (t, tone) { return A.label ? A.label(t, tone) : '<span>' + esc(t) + '</span>'; };
  var toast = function (t) { try { A.toast && A.toast(t); } catch (e) {} };
  var data = function () { return A.data || {}; };
  var ok = function (r) { return r && !r.error; };

  var S = { docs: null, shares: {}, intent: null, draft: null, buyer: null, seen: 0, demoIdx: 0, demoTimer: null, demo: false, started: false };
  var CSS = 'font-size:14px;color:var(--text);';
  var btn = 'height:32px;padding:0 12px;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:6px;font:inherit;font-size:14px;cursor:pointer;transition:all 200ms;';
  var link = 'background:none;border:0;padding:0;color:var(--gold);font:inherit;font-size:14px;cursor:pointer;transition:all 200ms;';
  var th = 'text-align:left;font-size:12px;font-weight:400;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--line);';
  var td = 'padding:0 12px;height:56px;font-size:14px;border-bottom:1px solid var(--line);vertical-align:middle;';

  function docs() {
    var l = S.docs || (data().documents) || [];
    return l;
  }
  function roleAccess(d, r) {
    if (d.locked) return false;
    if (!d.access) return r === 'Investment Team' ? true : null;
    return d.access.indexOf(r) >= 0;
  }
  function buyerOk(d) { return !d.access || d.access.indexOf('External Buyer') >= 0; }
  function demoEmail() { var c = (data().client_portal || {}).demo_client; return (c && c.email) || 'leung@demo.arca.room'; }
  function demoName() { var c = (data().client_portal || {}).demo_client; return (c && c.name) || 'Ms. Leung'; }
  function hasPdf(d) { return d.has_file || d.file || (d.pages > 0 && !d.locked); }

  /* ---------- Activity feed ---------- */
  function feedInit() {
    var el = $('audit-feed'); if (!el) return;
    el.innerHTML = '<div style="font-size:20px;font-weight:400;color:var(--text);padding:0 0 4px">Activity</div>' +
      '<div id="audit-count" style="font-size:12px;color:var(--muted);padding-bottom:12px;border-bottom:1px solid var(--line)">0 buyers in the room</div>' +
      '<div id="audit-rows"></div>';
  }
  function tone(r) {
    var t = ((r.result || '') + ' ' + (r.action || '') + ' ' + (r.text || '')).toLowerCase();
    if (/denied|403|blocked|no permission|refused/.test(t)) return ['Denied', 'negative'];
    if (/signed/.test(t)) return ['Signed', 'positive'];
    if (/approved|approve/.test(t)) return ['Approved', 'positive'];
    return null;
  }
  function addRows(rows, fromReplay) {
    var box = $('audit-rows'); if (!box || !rows || !rows.length) return;
    rows.forEach(function (r) {
      var row = document.createElement('div');
      var tg = tone(r);
      var guest = r.guest ? label('Guest', 'info') : '';
      var ts = r.ts ? new Date(r.ts) : new Date();
      var tm = isNaN(ts) ? esc(r.ts) : ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var txt = r.text != null ? r.text : [r.user, r.action, r.doc_id, r.result].filter(Boolean).join(' ');
      row.style.cssText = 'padding:12px 0;border-bottom:1px solid var(--line);opacity:0;transition:opacity 200ms;';
      row.innerHTML = '<div style="font-size:12px;color:var(--muted)">' + tm + '</div>' +
        '<div style="font-size:14px;color:var(--text);word-break:break-word">' + esc(txt) + '</div>' +
        ((tg || guest) ? '<div style="margin-top:4px;display:flex;gap:4px">' + (tg ? label(tg[0], tg[1]) : '') + guest + '</div>' : '');
      box.insertBefore(row, box.firstChild);
      requestAnimationFrame(function () { row.style.opacity = '1'; });
    });
    while (box.children.length > 60) box.removeChild(box.lastChild);
  }
  function pollAudit() {
    if (S.demo) return;
    api('/api/audit?since=' + S.seen).then(function (rows) {
      if (S.demo || !Array.isArray(rows)) return;
      if (S.seen === 0 && !rows.length) { var seed = data().audit_seed || []; rows = seed.map(function (t, i) { return { id: -1 - i, text: t, ts: new Date().toISOString() }; }).reverse(); addRows(rows); return; }
      var fresh = rows.filter(function (r) { return r.id > S.seen; });
      fresh.forEach(function (r) { if (r.id > S.seen) S.seen = r.id; });
      if (fresh.length) { addRows(fresh); try { A.emit('audit:new', fresh); } catch (e) {} }
    });
  }
  function pollStats() {
    api('/api/stats').then(function (s) {
      var c = $('audit-count'); if (!c) return;
      var n = s && typeof s.guestsInRoom === 'number' ? s.guestsInRoom : null;
      if (n == null) return;
      c.textContent = n + (n === 1 ? ' buyer in the room' : ' buyers in the room');
    });
  }
  function demoStep() {
    var list = data().audit_replay || [];
    if (!list.length) return;
    var t = list[S.demoIdx % list.length]; S.demoIdx++;
    var row = { id: 'd' + S.demoIdx, text: t, ts: new Date().toISOString(), guest: /guest\d+@/.test(t) };
    addRows([row]);
    try { A.emit('audit:new', [row]); } catch (e) {}
    var c = $('audit-count');
    if (c) { var n = Math.min(12, 1 + Math.floor(S.demoIdx / 2)); c.textContent = n + ' buyers in the room'; }
  }

  /* ---------- Security tab ---------- */
  function sectionTitle(t, sub) {
    return '<div style="margin:32px 0 12px"><div style="font-size:20px;color:var(--text)">' + esc(t) + '</div>' +
      (sub ? '<div style="font-size:12px;color:var(--muted);margin-top:4px">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function accessCell(d, r) {
    var a = roleAccess(d, r);
    if (d.locked) return label('Not shared', 'neutral');
    return a ? label('Allowed', 'positive') : label('No access', 'neutral');
  }
  function accessTable() {
    var h = '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + th + '">Document</th>' +
      ROLES.map(function (r) { return '<th style="' + th + '">' + r + '</th>'; }).join('') + '<th style="' + th + '">Status</th></tr></thead><tbody>';
    docs().forEach(function (d) {
      h += '<tr><td style="' + td + 'font-size:16px;font-weight:400">' + esc(d.name) + ' <span style="font-size:12px;color:var(--muted);font-family:\'JetBrains Mono\',monospace">' + esc(d.id) + '</span></td>' +
        ROLES.map(function (r) { return '<td style="' + td + '">' + accessCell(d, r) + '</td>'; }).join('') +
        '<td style="' + td + '">' + (d.redacted ? label('Redacted', 'neutral') : '<span style="color:var(--muted);font-size:12px">' + esc(d.status || '') + '</span>') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }
  function isShared(email, id) { return !!(S.shares[email] && S.shares[email][id]); }
  function shareControls() {
    var targets = [{ email: demoEmail(), name: demoName() }, { email: '*', name: 'Everyone in the room' }];
    var h = '<div id="share-controls">' + sectionTitle('Share with clients', 'Share or revoke per document. Revoke takes effect on the next client refresh.');
    targets.forEach(function (t) {
      h += '<div style="font-size:16px;margin:16px 0 4px">' + esc(t.name) + '</div><table style="width:100%;border-collapse:collapse"><tbody>';
      docs().forEach(function (d) {
        var can = !d.locked && buyerOk(d) && (d.status !== 'Outstanding') && d.pages !== 0;
        var act = '';
        if (!buyerOk(d)) act = label('Not cleared for buyers', 'neutral');
        else if (!can) act = label(d.locked ? 'Not shared' : 'Not received', 'neutral');
        else {
          var sh = isShared(t.email, d.id);
          act = '<button data-share="' + esc(d.id) + '" data-to="' + esc(t.email) + '" data-on="' + (sh ? 0 : 1) + '" style="' + btn + '">' + (sh ? 'Revoke' : 'Share') + '</button>';
          if (t.email !== '*' && hasPdf(d) && !sh) act += ' <button data-redact="' + esc(d.id) + '" data-to="' + esc(t.email) + '" style="' + link + 'margin-left:12px">Black out and share</button>';
        }
        h += '<tr><td style="' + td + 'width:55%">' + esc(d.name) + (d.redacted ? ' ' + label('Redacted', 'neutral') : '') + '</td><td style="' + td + '">' + act + '</td></tr>';
      });
      h += '</tbody></table>';
    });
    return h + '</div>';
  }
  function buyers() { return (data().buyers || []).slice(); }
  function total(b) { var t = 0; for (var k in (b.views || {})) t += +b.views[k] || 0; return t; }
  function signals() {
    var bs = buyers(), ds = ['D3', 'D5', 'D8'];
    var top = bs.slice().sort(function (a, b) { return total(b) - total(a); })[0];
    var maxT = Math.max.apply(null, bs.map(total).concat([1]));
    var h = sectionTitle('Buyer signals', 'Minutes per document') + '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + th + '">Buyer</th>' +
      ds.map(function (d) { return '<th style="' + th + '">' + d + '</th>'; }).join('') + '<th style="' + th + 'width:30%">Intent</th><th style="' + th + '"></th></tr></thead><tbody>';
    bs.forEach(function (b) {
      var pct = Math.round(100 * total(b) / maxT), isTop = b === top;
      var jev = isTop && S.intent ? S.intent : null;
      h += '<tr><td style="' + td + 'font-size:16px">' + esc(b.name) + '<div style="font-size:12px;color:var(--muted)">' + esc(b.last_seen || '') + '</div></td>' +
        ds.map(function (d) { return '<td style="' + td + '">' + ((b.views || {})[d] || 0) + '</td>'; }).join('') +
        '<td style="' + td + '"><div style="height:8px;background:var(--surface-2);border-radius:4px"><div style="height:8px;width:' + pct + '%;background:var(--gold);border-radius:4px;transition:width 200ms"></div></div>' +
        (jev ? '<div style="margin-top:4px">' + (A.badge ? A.badge('jev', jev.meta) : label('Jev', 'info') + ' <span style="font-size:12px;color:var(--muted)">' + esc(jev.meta) + '</span>') + '</div>' : '') + '</td>' +
        '<td style="' + td + '">' + (isTop ? label('Hot lead', 'warning') : '') + '</td></tr>';
    });
    h += '</tbody></table><div style="margin-top:16px"><button id="sec-draft" style="' + btn + '">Draft follow-up</button></div>';
    return h;
  }
  function draftBlock() {
    if (!S.draft) return '<div id="sec-draft-out"></div>';
    var d = S.draft;
    return '<div id="sec-draft-out" style="margin-top:16px"><div style="display:flex;gap:16px">' +
      '<div style="flex:1;border:1px solid var(--line);border-radius:6px;padding:16px"><div style="font-size:12px;color:var(--muted);margin-bottom:8px">English ' + (A.badge ? A.badge(d.by || 'cached') : '') + '</div><div style="font-size:14px;line-height:1.6">' + esc(d.en) + '</div></div>' +
      '<div style="flex:1;border:1px solid var(--line);border-radius:6px;padding:16px"><div style="font-size:12px;color:var(--muted);margin-bottom:8px">繁中</div><div style="font-size:14px;line-height:1.7;font-family:\'Noto Sans TC\',Inter,sans-serif">' + esc(d.zh) + '</div></div></div>' +
      '<div style="margin-top:16px;text-align:right"><button id="sec-send" style="height:40px;padding:0 16px;border:0;border-radius:6px;background:var(--gold);color:#fff;font:inherit;font-size:16px;font-weight:500;cursor:pointer;transition:all 200ms">Approve and send</button></div></div>';
  }

  function render() {
    var el = $('tab-security'); if (!el) return;
    var h = '<div style="padding:0 0 48px"><div style="font-size:28px;color:var(--text)">Security</div>' +
      '<div style="font-size:14px;color:var(--muted);margin-top:4px">Access by role, client sharing and buyer interest.</div>' +
      sectionTitle('Document access') + accessTable() + shareControls() + signals() + draftBlock() + '</div>';
    el.innerHTML = h;
    wire(el);
  }
  function wire(el) {
    Array.prototype.forEach.call(el.querySelectorAll('[data-share]'), function (b) {
      b.onclick = safe(function () { doShare(b.getAttribute('data-to'), b.getAttribute('data-share'), b.getAttribute('data-on') === '1'); });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-redact]'), function (b) {
      b.onclick = safe(function () {
        if (A.viewer && A.viewer.open) A.viewer.open({ docId: b.getAttribute('data-redact'), mode: 'redact', shareTo: b.getAttribute('data-to') });
        else toast('Viewer not available');
      });
    });
    var dr = $('sec-draft'); if (dr) dr.onclick = safe(draft);
    var sd = $('sec-send'); if (sd) sd.onclick = safe(send);
  }
  function doShare(email, docId, shared) {
    api('/api/share', { method: 'POST', body: { clientEmail: email, docId: docId, shared: shared } }).then(function (r) {
      if (r && r.error) { toast(r.error); return; }
      (S.shares[email] = S.shares[email] || {})[docId] = shared;   // optimistic if offline
      try { A.emit('share:changed', { clientEmail: email, docId: docId, shared: shared }); } catch (e) {}
      toast((shared ? 'Shared ' : 'Revoked ') + docId + (email === '*' ? ' for everyone' : ' for ' + demoName()));
      render();
    });
  }
  function draft() {
    var top = buyers().sort(function (a, b) { return total(b) - total(a); })[0];
    var name = (top && top.name) || demoName();
    toast('Drafting follow-up');
    api('/api/followup', { method: 'POST', body: { buyer: name } }).then(function (r) {
      var c = data().cached_ai || {};
      if (ok(r) && (r.en || r.zh)) S.draft = { en: r.en, zh: r.zh, by: r.processed_by };
      else S.draft = { en: c.follow_up_en || '', zh: c.follow_up_zh || '', by: 'cached' };
      render();
    });
  }
  function send() {
    var d = S.draft; if (!d) return;
    api('/api/messages', { method: 'POST', body: { clientEmail: demoEmail(), en: d.en, zh: d.zh } }).then(function (r) {
      if (r && r.error) { toast(r.error); return; }
      try { A.emit('followup:sent', { clientEmail: demoEmail(), en: d.en, zh: d.zh }); } catch (e) {}
      toast('Follow-up sent to ' + demoName());
      S.draft = null; render();
    });
  }
  function loadIntent() {
    var cj = ((data().cached_ai || {}).jev || {}).intent || {};
    var fb = { meta: '97% · ' + (cj.latency_ms || 489) + ' ms' };
    api('/api/decide/intent', { method: 'POST', body: { buyer: demoName() } }).then(function (r) {
      if (ok(r) && r.latency_ms) {
        var conf = r.confidence != null ? r.confidence : (r.answers && r.answers.intent && r.answers.intent.confidence);
        S.intent = { meta: Math.round((conf || 0.94) * 100) + '% · ' + r.latency_ms + ' ms' };
      } else S.intent = fb;
      render();
    });
  }
  function loadDocs() {
    api('/api/documents').then(function (l) { if (Array.isArray(l)) { S.docs = l.map(function (d) { var s = (data().documents || []).filter(function (x) { return x.id === d.id; })[0] || {}; return Object.assign({}, s, d); }); render(); } });
  }
  function loadShares() {
    var cp = data().client_portal || {};
    var em = demoEmail();
    S.shares[em] = S.shares[em] || {};
    (cp.initially_shared || []).forEach(function (id) { S.shares[em][id] = true; });
  }

  var start = safe(function () {
    if (S.started) return; S.started = true;
    loadShares(); feedInit(); render(); loadDocs(); loadIntent();
    pollAudit(); pollStats();
    setInterval(safe(pollAudit), 2000);
    setInterval(safe(pollStats), 3000);
  });

  try {
    A.on && A.on('ready', start);
    A.on && A.on('role:changed', safe(function () { S.docs = null; loadDocs(); render(); }));
    A.on && A.on('docs:changed', safe(function (p) { if (p && Array.isArray(p.docs)) S.docs = p.docs.map(function (d) { var s = (data().documents || []).filter(function (x) { return x.id === d.id; })[0] || {}; return Object.assign({}, s, d); }); render(); }));
    A.on && A.on('share:changed', safe(function (p) { if (p && p.clientEmail) { (S.shares[p.clientEmail] = S.shares[p.clientEmail] || {})[p.docId] = !!p.shared; } render(); }));
    A.on && A.on('demo:toggle', safe(function (p) {
      S.demo = !!(p && p.on);
      clearInterval(S.demoTimer);
      if (S.demo) { demoStep(); S.demoTimer = setInterval(safe(demoStep), 1500); }
    }));
    if (A.data) start();
  } catch (e) {}
})();
