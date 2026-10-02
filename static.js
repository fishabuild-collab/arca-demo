// Static demo shim: answers every /api/* call in the browser from demo_data.json and the mock
// documents, so the console runs on GitHub Pages with no server and no AI connection.
// All AI results come from cached_ai and are labelled "Cached".
(function () {
  'use strict';

  const USERS = {
    inv: { role: 'Investment Team', user: 'Alex (Investment)' },
    law: { role: 'Lawyer', user: 'Wong & Partners (Lawyer)' },
    bank: { role: 'Banker', user: 'HSBC Mortgages (Banker)' },
    buyer: { role: 'External Buyer', user: 'Mr. Chan (Buyer)' },
  };
  const realFetch = window.fetch.bind(window);
  let current = 'inv';
  let audit = [];
  let auditId = 0;
  let dataP = null;

  const loadData = () => (dataP = dataP || realFetch('demo_data.json').then((r) => r.json()).then((d) => { seedAudit(d); return d; }));
  const role = () => USERS[current].role;
  const allowed = (d) => (d.access || []).includes(role());
  const nowIso = () => new Date().toISOString();

  function addAudit(user, action, doc_id, result) {
    audit.push({ id: ++auditId, ts: nowIso(), user, action, doc_id: doc_id || null, result: result || '', guest: false });
  }

  function seedAudit(d) {
    const list = d.audit_seed || [];
    list.forEach((s, i) => {
      const m = s.match(/^(.+?)\s(viewed|downloaded|blocked from|approved|flagged|updated)\s?(.*)$/);
      const row = { id: ++auditId, ts: new Date(Date.now() - (list.length - i) * 240000).toISOString(), user: 'Arca', action: s, doc_id: null, result: '', guest: false };
      if (m) { row.user = m[1]; row.action = m[2] === 'blocked from' ? 'denied' : m[2]; row.result = m[3]; }
      audit.push(row);
    });
  }

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function listItem(d) {
    return { id: d.id, name: d.name, type: d.type, status: d.status, pages: d.pages, uploaded_by: d.uploaded_by, date: d.date, locked: false, redacted: false, processed_by: 'cached' };
  }

  function filtered(d) {
    const out = JSON.parse(JSON.stringify(d));
    out.documents = d.documents.map((x) => (allowed(x) ? listItem(x) : { id: x.id, name: x.name, type: x.type, locked: true }));
    const ca = out.cached_ai || {};
    ca.ask_the_room = (ca.ask_the_room || []).map((e) => (e.a_by_role ? { q: e.q, a: e.a_by_role[role()] || e.a_by_role.default } : e));
    if (role() === 'External Buyer') {
      out.extracted_fields = []; out.conflicts = [];
      delete out.buyers; delete ca.pricing_recommendation; delete ca.follow_up_en; delete ca.follow_up_zh;
    }
    return out;
  }

  function cachedAsk(d, q) {
    const words = String(q || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    let best = null, score = 0;
    (d.cached_ai.ask_the_room || []).forEach((x) => {
      const s = words.filter((w) => x.q.toLowerCase().includes(w)).length;
      if (s > score) { score = s; best = x; }
    });
    if (!best) return { a: 'This static demo only has cached answers. Try one of the suggested questions.', sources: [], processed_by: 'cached' };
    const a = best.a || (best.a_by_role && (best.a_by_role[role()] || best.a_by_role.default));
    return { a, sources: (String(a).match(/\bD\d+\b/g) || []).filter((v, i, s) => s.indexOf(v) === i), processed_by: 'cached' };
  }

  async function route(path, method, body) {
    const d = await loadData();
    let m;
    if (path === '/api/me') return json(200, Object.assign({ userId: current }, USERS[current]));
    if (path === '/api/login') { if (USERS[body.userId]) current = body.userId; return json(200, Object.assign({ userId: current }, USERS[current])); }
    if (path === '/api/data') return json(200, filtered(d));
    if (path === '/api/documents') return json(200, filtered(d).documents);
    if (path === '/api/extraction') {
      if (role() === 'External Buyer') return json(200, { fields: [], conflicts: [], processed_by: 'cached' });
      return json(200, { fields: d.extracted_fields, conflicts: d.conflicts, processed_by: 'cached' });
    }
    if ((m = path.match(/^\/api\/documents\/([^/]+)(\/file)?$/))) {
      const doc = d.documents.find((x) => x.id === m[1]);
      if (!doc) return json(404, { error: 'Not found' });
      if (!allowed(doc)) { addAudit(USERS[current].user, 'denied', doc.id, doc.name + ' – no permission'); return json(403, { error: 'Not permitted' }); }
      if (m[2]) {
        if (!doc.file) return json(404, { error: 'No PDF' });
        addAudit(USERS[current].user, 'viewed', doc.id, doc.name);
        return realFetch(doc.file);
      }
      let text = '';
      if (doc.text) { try { text = await (await realFetch(doc.text)).text(); } catch (_) {} }
      if (!text) text = `${doc.name}\n\nThis mock document has no text layer in the static demo.`;
      return json(200, { id: doc.id, name: doc.name, text, watermark: `${USERS[current].user} · ${nowIso().slice(0, 16).replace('T', ' ')} · Arca`, redacted: false, boxes: 0, has_file: !!doc.file });
    }
    if (path.startsWith('/api/audit')) {
      const since = Number(new URLSearchParams(path.split('?')[1] || '').get('since')) || 0;
      return json(200, audit.filter((r) => r.id > since));
    }
    if (path === '/api/events') { addAudit(USERS[current].user, body.action || 'event', body.doc_id, body.result); return json(200, { ok: true }); }
    if ((m = path.match(/^\/api\/decide\/(\w+)$/))) {
      const j = d.cached_ai.jev && d.cached_ai.jev[m[1]];
      return j ? json(200, Object.assign({}, j, { processed_by: 'cached' })) : json(404, { error: 'No cached decision' });
    }
    if (path === '/api/ask') return json(200, cachedAsk(d, body.q));
    if (path === '/api/followup') return json(200, { en: d.cached_ai.follow_up_en, zh: d.cached_ai.follow_up_zh, processed_by: 'cached' });
    if (path === '/api/stats') return json(200, { guestsInRoom: 0 });
    if (path === '/api/share') { addAudit(USERS[current].user, body.shared ? 'shared' : 'revoked', body.docId, 'with ' + body.clientEmail); return json(200, Object.assign({ ok: true }, body)); }
    if (path === '/api/messages') { addAudit(USERS[current].user, 'sent follow-up', null, 'to ' + body.clientEmail); return json(200, { ok: true }); }
    return json(503, { error: 'Not available in the static demo' });
  }

  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const i = url.pathname.indexOf('/api/');
    if (url.origin !== location.origin || i === -1) return realFetch(input, init);
    const path = url.pathname.slice(i) + url.search;
    const method = (init && init.method) || 'GET';
    let body = {};
    try { if (init && typeof init.body === 'string') body = JSON.parse(init.body); } catch (_) {}
    return route(path, method, body).catch(() => json(500, { error: 'Static demo error' }));
  };
})();
