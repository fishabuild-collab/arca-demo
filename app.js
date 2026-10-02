// Arca console shell: globals, nav, Deal room, Extraction, conflict modal, upload, roles, demo mode.
(function () {
  'use strict';

  const USERS = {
    inv: { role: 'Investment Team', user: 'Alex (Investment)', initials: 'AL' },
    law: { role: 'Lawyer', user: 'Wong & Partners (Lawyer)', initials: 'WP' },
    bank: { role: 'Banker', user: 'HSBC Mortgages (Banker)', initials: 'HB' },
    buyer: { role: 'External Buyer', user: 'Mr. Chan (Buyer)', initials: 'MC' },
  };

  const listeners = {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const Arca = (window.Arca = window.Arca || {});
  Object.assign(Arca, {
    data: null,
    state: { role: 'Investment Team', user: 'Alex (Investment)', userId: 'inv', demoMode: false },
    esc,

    async api(path, opts = {}) {
      try {
        const headers = Object.assign({}, opts.headers || {});
        let body = opts.body;
        if (body != null && !opts.raw) {
          if (typeof body !== 'string') body = JSON.stringify(body);
          headers['content-type'] = 'application/json';
        }
        const res = await fetch(path, {
          method: opts.method || (body != null ? 'POST' : 'GET'),
          headers, body, credentials: 'same-origin',
        });
        let json = null;
        try { json = await res.json(); } catch (_) { json = {}; }
        if (!res.ok) return Object.assign({ error: (json && json.error) || res.statusText, status: res.status }, json);
        return json;
      } catch (_) {
        return null;
      }
    },

    fmtHKD(n) { return n == null || isNaN(n) ? '—' : 'HK$' + Math.round(Number(n)).toLocaleString('en-US'); },
    fmtPsf(n) { return n == null || isNaN(n) ? '—' : 'HK$' + Math.round(Number(n)).toLocaleString('en-US') + '/sq ft'; },

    label(text, tone = 'neutral') { return `<span class="label ${tone}">${esc(text)}</span>`; },

    badge(processed_by, extra) {
      const map = { local: ['Local', 'positive'], jev: ['Jev', 'info'], cloud: ['Cloud', 'info'], cached: ['Cached', 'neutral'], ollama: ['Local', 'positive'] };
      const [t, tone] = map[processed_by] || map.cached;
      return Arca.label(t, tone) + (extra ? ` <span class="meta">${esc(extra)}</span>` : '');
    },

    toast(text) {
      const root = document.getElementById('toast-root');
      if (!root) return;
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = text;
      root.appendChild(el);
      setTimeout(() => el.remove(), 3200);
    },

    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, payload) {
      (listeners[evt] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.warn('[Arca] handler for', evt, e); } });
    },
  });

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const jevExtra = (r) => {
    if (!r) return '';
    const conf = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '';
    const ms = r.latency_ms != null ? Math.round(r.latency_ms) + ' ms' : '';
    return [conf, ms].filter(Boolean).join(' · ');
  };
  const fmtDate = (d) => {
    if (!d) return '—';
    const t = new Date(d);
    return isNaN(t) ? esc(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  let docs = [];
  let docsKey = '';
  let extraction = null;
  const resolved = {}; // field -> 'approved' | 'clarify'
  const fresh = new Set();
  let filter = 'all';
  let query = '';

  const docName = (id) => {
    const d = docs.find((x) => x.id === id) || ((Arca.data && Arca.data.documents) || []).find((x) => x.id === id);
    return d ? d.name : id;
  };
  const conflicts = () => (extraction && extraction.conflicts) || (Arca.data && Arca.data.conflicts) || [];
  const openConflicts = () => conflicts().filter((c) => !resolved[c.field]);
  const conflictDocs = () => new Set(openConflicts().map((c) => c.b && c.b.doc).filter(Boolean));

  function statusLabel(d) {
    if (d.locked) return Arca.label('Not shared', 'neutral');
    if (conflictDocs().has(d.id)) return Arca.label('Conflict', 'negative');
    const s = d.status || 'Received';
    const tone = /received|approved/i.test(s) ? 'positive' : /outstanding|pending|draft/i.test(s) ? 'warning' : /denied|revoked|conflict/i.test(s) ? 'negative' : 'neutral';
    return Arca.label(s, tone);
  }

  // ---------- data loading ----------
  async function ensureLogin() {
    const me = await Arca.api('/api/me');
    if (me && !me.error && me.userId && USERS[me.userId]) return setUser(me.userId);
    if (me && me.status === 401) {
      const r = await Arca.api('/api/login', { method: 'POST', body: { userId: Arca.state.userId } });
      if (r && !r.error) return setUser(Arca.state.userId);
    }
  }

  function setUser(userId) {
    const u = USERS[userId] || USERS.inv;
    Object.assign(Arca.state, { userId, role: u.role, user: u.user });
    const av = $('#avatar');
    if (av) av.textContent = u.initials;
  }

  async function loadData() {
    const d = await Arca.api('/api/data');
    if (d && !d.error) Arca.data = d;
    if (!Arca.data) Arca.data = { documents: [], conflicts: [], extracted_fields: [], deal: {}, cached_ai: {} };
    docs = (Arca.data.documents || []).slice();
    await refreshDocs(true);
    await loadExtraction();
  }

  async function refreshDocs(silent) {
    if (Arca.state.demoMode) return;
    const list = await Arca.api('/api/documents');
    if (!Array.isArray(list)) return;
    const key = JSON.stringify(list);
    if (key === docsKey) return;
    const before = new Set(docs.map((d) => d.id));
    docsKey = key;
    docs = list;
    if (!silent) list.forEach((d) => { if (!before.has(d.id)) fresh.add(d.id); });
    Arca.emit('docs:changed', { docs });
    renderSidebar();
    renderDealroom();
  }

  async function loadExtraction() {
    const r = Arca.state.demoMode ? null : await Arca.api('/api/extraction');
    if (r && !r.error && Array.isArray(r.fields)) extraction = r;
    else extraction = { fields: (Arca.data && Arca.data.extracted_fields) || [], conflicts: (Arca.data && Arca.data.conflicts) || [], processed_by: 'cached' };
    if (Arca.state.role === 'External Buyer') extraction = { fields: [], conflicts: [], processed_by: extraction.processed_by };
    renderExtraction();
    renderDealroom();
    renderSidebar();
  }

  // ---------- nav ----------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  }

  const ICON = {
    docs: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 2h5l3 3v9H4z" stroke="currentColor"/><path d="M9 2v3h3" stroke="currentColor"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor"/><path d="M8 5v3l2 2" stroke="currentColor"/></svg>',
    alert: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l6 11H2z" stroke="currentColor"/><path d="M8 7v3M8 11.5v.5" stroke="currentColor"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor"/><circle cx="8" cy="8" r="2" stroke="currentColor"/></svg>',
    user: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor"/><path d="M3 14c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" stroke="currentColor"/></svg>',
  };

  function counts() {
    const visible = docs.filter((d) => !d.locked);
    return {
      all: docs.length,
      outstanding: visible.filter((d) => /outstanding/i.test(d.status || '')).length,
      pending: visible.filter((d) => /pending/i.test(d.status || '')).length,
      conflicts: openConflicts().length,
      received: visible.filter((d) => /received/i.test(d.status || '')).length,
    };
  }

  function renderSidebar() {
    const el = $('#sidebar');
    if (!el) return;
    const c = counts();
    const item = (key, icon, text, count) =>
      `<button class="side-item ${filter === key ? 'on' : ''}" data-filter="${key}">${ICON[icon]}<span>${text}</span><span class="count">${count}</span></button>`;
    const roleItem = (id) =>
      `<button class="side-item ${Arca.state.userId === id ? 'on' : ''}" data-user="${id}">${ICON.user}<span>${esc(USERS[id].role)}</span></button>`;
    el.innerHTML =
      '<div class="group">Documents</div>' +
      item('all', 'docs', 'All documents', c.all) +
      item('outstanding', 'clock', 'Outstanding', c.outstanding) +
      item('pending', 'eye', 'Pending review', c.pending) +
      item('conflicts', 'alert', 'Conflicts', c.conflicts) +
      '<div class="group">View as</div>' +
      ['inv', 'law', 'bank', 'buyer'].map(roleItem).join('');
    const ec = $('#extraction-count');
    if (ec) ec.textContent = c.conflicts ? String(c.conflicts) : '';
  }

  function renderRoleMenu() {
    const m = $('#role-menu');
    if (!m) return;
    m.innerHTML = '<div class="group">View as</div>' + Object.keys(USERS).map((id) =>
      `<button data-user="${id}" class="${Arca.state.userId === id ? 'on' : ''}"><span>${esc(USERS[id].role)}</span><span class="meta">${esc(USERS[id].user)}</span></button>`).join('');
  }

  async function switchUser(userId) {
    if (!USERS[userId] || userId === Arca.state.userId) return;
    const r = await Arca.api('/api/login', { method: 'POST', body: { userId } });
    if (r === null && !Arca.state.demoMode) Arca.toast('Server unreachable · switched locally');
    setUser(userId);
    docsKey = '';
    await loadData();
    renderRoleMenu();
    Arca.emit('role:changed', { role: Arca.state.role, user: Arca.state.user, userId });
    Arca.toast('Viewing as ' + Arca.state.role);
  }

  // ---------- Deal room ----------
  function filteredDocs() {
    let list = docs.slice();
    if (filter === 'outstanding') list = list.filter((d) => !d.locked && /outstanding/i.test(d.status || ''));
    if (filter === 'pending') list = list.filter((d) => !d.locked && /pending/i.test(d.status || ''));
    if (filter === 'conflicts') { const s = conflictDocs(); list = list.filter((d) => s.has(d.id)); }
    if (query) { const q = query.toLowerCase(); list = list.filter((d) => (d.name + ' ' + d.type + ' ' + (d.uploaded_by || '') + ' ' + d.id).toLowerCase().includes(q)); }
    // newest uploads first, then by id
    return list.sort((a, b) => (fresh.has(b.id) - fresh.has(a.id)) || (b.uploaded ? 1 : 0) - (a.uploaded ? 1 : 0) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  }

  function renderDealroom() {
    const el = $('#tab-dealroom');
    if (!el || !Arca.data) return;
    const deal = Arca.data.deal || {};
    const c = counts();
    const required = docs.length || 1;
    const pct = Math.round((c.received / required) * 100);
    const isBuyer = Arca.state.role === 'External Buyer';
    const filterNames = { all: 'All documents', outstanding: 'Outstanding', pending: 'Pending review', conflicts: 'Conflicts' };
    const rows = filteredDocs().map((d) => {
      const ai = d.jev ? Arca.badge('jev', jevExtra(d.jev)) : d.processed_by ? Arca.badge(d.processed_by) : '';
      return `<tr class="clickable ${fresh.has(d.id) ? 'fresh' : ''}" data-doc="${esc(d.id)}">
        <td class="id">${esc(d.id)}</td>
        <td><div class="name">${esc(d.name)}</div><div class="meta">${esc(d.type || '')}${d.pages ? ' · ' + d.pages + ' pages' : ''}</div></td>
        <td class="num">${fmtDate(d.date)}</td>
        <td class="muted">${esc(d.uploaded_by || '—')}</td>
        <td>${statusLabel(d)} ${d.redacted ? Arca.label('Redacted', 'neutral') : ''}</td>
        <td>${ai}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Deal room</h1>
          <div class="muted">${esc(deal.name || '')}</div>
        </div>
        <div class="actions">
          ${isBuyer ? '' : '<button class="btn btn-outline" id="btn-invite">Invite the room</button>'}
          ${isBuyer ? '' : '<button class="btn btn-primary" id="btn-upload">Upload</button>'}
          <input type="file" id="file-input" hidden>
        </div>
      </div>
      <div class="summary num">${c.received} of ${required} received · ${c.outstanding} outstanding · ${c.conflicts} conflicts · ${Arca.fmtHKD(deal.price_hkd)} · ${Arca.fmtPsf(deal.price_per_sqft)} · ${deal.saleable_area_sqft || '—'} sq ft</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="toolbar">
        <input class="search" id="doc-search" placeholder="Search documents" value="${esc(query)}">
      </div>
      <div class="toolbar">
        ${Object.keys(filterNames).map((k) => `<button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}">${filter === k ? '' : '+ '}${filterNames[k]}</button>`).join('')}
        <span class="meta" style="margin-left:auto">${docs.filter((d) => !d.locked).length} of ${docs.length} visible to ${esc(Arca.state.role)}${isBuyer ? '' : ' · drop a file on the table to upload'}</span>
      </div>
      <div class="table-wrap" id="drop-zone">
        <table class="t">
          <thead><tr><th>ID</th><th>Name</th><th>Updated</th><th>By</th><th>Status</th><th>AI</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty">No documents match.</td></tr>'}</tbody>
        </table>
      </div>
      ${renderAsk()}
    `;
    const s = $('#doc-search');
    if (s && document.activeElement && document.activeElement.id === 'doc-search-pending') s.focus();
  }

  // ---------- Ask the room ----------
  let lastAnswer = null;
  function renderAsk() {
    const qs = ((Arca.data && Arca.data.cached_ai && Arca.data.cached_ai.ask_the_room) || []).slice(0, 4).map((x) => x.q);
    const a = lastAnswer;
    return `
      <div class="ask">
        <h2>Ask the room</h2>
        <div class="meta">Answers come only from documents ${esc(Arca.state.role)} is allowed to see.</div>
        <form id="ask-form"><input class="search" id="ask-q" placeholder="Ask about this deal" autocomplete="off"><button class="btn btn-outline" type="submit">Ask</button></form>
        <div class="suggest">${qs.map((q) => `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        ${a ? `<div class="answer">${esc(a.a)}<div class="meta">${Arca.badge(a.processed_by)} ${(a.sources || []).map((s) => `<a class="link" data-open="${esc(s)}">${esc(docName(s))}</a>`).join(' · ')}</div></div>` : ''}
      </div>`;
  }

  function cachedAnswer(q) {
    const list = (Arca.data && Arca.data.cached_ai && Arca.data.cached_ai.ask_the_room) || [];
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    let best = null, score = 0;
    list.forEach((x) => {
      const s = words.filter((w) => x.q.toLowerCase().includes(w)).length;
      if (s > score) { score = s; best = x; }
    });
    if (!best) return { a: 'No cached answer for that question.', sources: [], processed_by: 'cached' };
    let a = best.a;
    if (!a && best.a_by_role) a = best.a_by_role[Arca.state.role] || best.a_by_role.default || Object.values(best.a_by_role)[0];
    return { a, sources: [], processed_by: 'cached' };
  }

  async function ask(q) {
    if (!q) return;
    lastAnswer = { a: 'Reading the documents…', sources: [], processed_by: 'local' };
    renderDealroom();
    let r = Arca.state.demoMode ? null : await Arca.api('/api/ask', { method: 'POST', body: { q } });
    if (!r || r.error || !r.a) r = cachedAnswer(q);
    lastAnswer = r;
    renderDealroom();
  }

  // ---------- upload ----------
  async function upload(file) {
    if (!file) return;
    if (Arca.state.role === 'External Buyer') return Arca.toast('Buyers cannot upload here');
    const tmpId = 'new-' + Date.now();
    docs.unshift({ id: '…', name: file.name, type: 'Reading', status: 'Pending review', date: new Date().toISOString(), uploaded_by: Arca.state.user, _tmp: tmpId });
    fresh.add('…');
    renderDealroom();
    let r = null;
    if (!Arca.state.demoMode) {
      const buf = await file.arrayBuffer();
      r = await Arca.api('/api/upload', { method: 'POST', raw: true, body: buf, headers: { 'x-filename': file.name, 'content-type': 'application/octet-stream' } });
    }
    docs = docs.filter((d) => d._tmp !== tmpId);
    fresh.delete('…');
    if (r && !r.error && r.doc) {
      const doc = Object.assign({}, r.doc, { jev: r.jev || r.doc.jev });
      fresh.add(doc.id);
      docs = [doc].concat(docs.filter((d) => d.id !== doc.id));
      Arca.emit('doc:uploaded', { doc, jev: r.jev });
      const conf = r.jev && r.jev.confidence;
      Arca.toast(`${doc.name} encrypted and filed${conf != null ? ' · Jev ' + Math.round(conf * 100) + '%' : ''}`);
      docsKey = '';
      setTimeout(() => { refreshDocs(true); loadExtraction(); }, 1500);
    } else {
      // offline / demo: classify from cache
      const jev = Arca.data.cached_ai && Arca.data.cached_ai.jev && Arca.data.cached_ai.jev.doctype;
      const doc = { id: 'U' + (docs.length + 1), name: file.name, type: 'Technical', status: 'Received', date: new Date().toISOString(), uploaded_by: Arca.state.user, uploaded: true, processed_by: 'cached', jev: jev ? { confidence: jev.answers.doc_type.confidence, latency_ms: jev.latency_ms } : null };
      fresh.add(doc.id);
      docs.unshift(doc);
      Arca.emit('doc:uploaded', { doc, jev });
      Arca.toast(file.name + ' filed (cached)');
    }
    renderSidebar();
    renderDealroom();
  }

  // ---------- open a document ----------
  async function openDoc(id, highlight) {
    const d = docs.find((x) => x.id === id);
    if (d && d.locked) {
      // still hit the server so the denial is logged
      if (!Arca.state.demoMode) await Arca.api('/api/documents/' + encodeURIComponent(id));
      Arca.toast(`${d.name}: not permitted for ${Arca.state.role} · never sent · logged`);
      return;
    }
    if (Arca.viewer && Arca.viewer.open) {
      try { Arca.viewer.open({ docId: id, highlight, watermark: `${Arca.state.user} · ${Arca.state.role}` }); return; } catch (e) { console.warn(e); }
    }
    const r = await Arca.api('/api/documents/' + encodeURIComponent(id));
    if (r && r.status === 403) return Arca.toast('Not permitted · logged');
    if (r && r.text) {
      modal(`<div class="modal-head"><h2>${esc(r.name || docName(id))}</h2><button class="close" data-close>×</button></div>
        <div class="modal-body"><pre style="white-space:pre-wrap;font:14px/1.6 var(--font)">${esc(r.text)}</pre><div class="meta">${esc(r.watermark || '')}</div></div>`);
    }
  }

  // ---------- Extraction ----------
  function renderExtraction() {
    const el = $('#tab-extraction');
    if (!el) return;
    const ex = extraction || { fields: [], conflicts: [] };
    if (Arca.state.role === 'External Buyer') {
      el.innerHTML = `<div class="page-head"><h1>Extraction</h1></div><p class="muted">${Arca.label('Not shared', 'neutral')} Extracted fields are internal and not shared with buyers.</p>`;
      return;
    }
    const cf = ex.conflicts || [];
    const byField = {};
    cf.forEach((c) => { byField[c.field] = c; });
    const src = (s, p) => s && s !== 'computed' ? `<a class="link" data-open="${esc(s)}" data-page="${p || ''}">${esc(docName(s))}${p ? ', p.' + p : ''}</a>` : '<span class="meta">Computed</span>';
    const rows = (ex.fields || []).map((f) => {
      const c = byField[f.field];
      const st = c ? (resolved[f.field] === 'approved' ? Arca.label('Approved', 'positive') : resolved[f.field] === 'clarify' ? Arca.label('Clarification requested', 'warning') : Arca.label('Conflict', 'negative'))
        : Arca.label('Matches', 'positive');
      return `<tr class="${c ? 'clickable' : ''}" ${c ? `data-conflict="${esc(f.field)}"` : ''}>
        <td class="name">${esc(f.field)}</td>
        <td class="num">${esc(f.value)}</td>
        <td>${src(f.source, f.page)}<div class="meta">${esc(f.quote || '')}</div></td>
        <td class="num muted">${f.confidence != null ? Math.round(f.confidence * 100) + '%' : '—'}</td>
        <td>${st}</td>
      </tr>`;
    }).join('');
    // conflicts whose field is not in the fields table (e.g. Price vs valuation)
    const extra = cf.filter((c) => !(ex.fields || []).some((f) => f.field === c.field)).map((c) => {
      const st = resolved[c.field] === 'approved' ? Arca.label('Approved', 'positive') : resolved[c.field] === 'clarify' ? Arca.label('Clarification requested', 'warning') : Arca.label(c.severity === 'medium' ? 'Variance' : 'Conflict', c.severity === 'medium' ? 'warning' : 'negative');
      return `<tr class="clickable" data-conflict="${esc(c.field)}">
        <td class="name">${esc(c.field)}</td>
        <td class="muted">${esc(c.a.quote)} vs ${esc(c.b.quote)}</td>
        <td>${src(c.a.doc, c.a.page)} · ${src(c.b.doc, c.b.page)}</td>
        <td class="muted">—</td><td>${st}</td></tr>`;
    }).join('');
    el.innerHTML = `
      <div class="page-head"><div><h1>Extraction</h1></div><div class="actions">${Arca.badge(ex.processed_by || 'cached')}</div></div>
      <div class="summary">${(ex.fields || []).length} fields read from ${new Set((ex.fields || []).map((f) => f.source).filter((s) => s && s !== 'computed')).size} documents · ${openConflicts().length} open conflicts · values are found by the local model, quotes and conflicts are checked in code</div>
      <table class="t">
        <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Confidence</th><th>Status</th></tr></thead>
        <tbody>${rows}${extra}</tbody>
      </table>`;
  }

  // ---------- Conflict modal ----------
  function modal(html) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="backdrop"><div class="modal" role="dialog">${html}</div></div>`;
    root.querySelector('.backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('backdrop') || e.target.hasAttribute('data-close')) closeModal();
    });
  }
  function closeModal() { const r = $('#modal-root'); if (r) r.innerHTML = ''; }

  function markQuote(q) {
    // highlight the number/date inside the quote
    const s = esc(q);
    const m = s.match(/(HK\$[\d,]+|\d[\d,]*\s*(square feet|sq ft)|\d{1,2}\s+\w+\s+\d{4}|\d{1,2}\s\w{3}\s\d{4})/i);
    return m ? s.replace(m[0], `<mark>${m[0]}</mark>`) : `<mark>${s}</mark>`;
  }

  async function openConflict(field) {
    const c = conflicts().find((x) => x.field === field);
    if (!c) return;
    const quote = (side) => `
      <div class="quote">
        <div class="src"><a class="link" data-open="${esc(side.doc)}" data-page="${side.page || ''}" data-quote="${esc(side.quote)}">${esc(docName(side.doc))}, p.${esc(side.page)}</a></div>
        <p>“${markQuote(side.quote)}”</p>
      </div>`;
    modal(`
      <div class="modal-head"><h2>${esc(c.field)}</h2>${Arca.label(c.severity === 'high' ? 'High' : 'Medium', c.severity === 'high' ? 'negative' : 'warning')}<button class="close" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <div class="quotes">${quote(c.a)}${quote(c.b)}</div>
        <p class="explain">${esc(c.ai_explanation || '')}</p>
        <div class="jev-line" id="jev-line">Jev is checking materiality…</div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-outline" data-resolve="clarify">Request clarification</button>
        <button class="btn btn-primary" data-resolve="approved">Approve</button>
      </div>`);
    const root = $('#modal-root');
    root.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => resolve(c, b.dataset.resolve)));

    let r = Arca.state.demoMode ? null : await Arca.api('/api/decide/conflict', { method: 'POST', body: { field: c.field, a: c.a, b: c.b } });
    if (!r || r.error || !r.answers) {
      const cj = Arca.data.cached_ai && Arca.data.cached_ai.jev && Arca.data.cached_ai.jev.conflict;
      r = cj ? Object.assign({ processed_by: 'cached' }, cj) : null;
    }
    const line = $('#jev-line');
    if (!line) return;
    if (!r) { line.textContent = ''; return; }
    const a = r.answers || {};
    const pct = (k) => (a[k] && a[k].noul != null ? Math.round(a[k].noul * 100) + '%' : null);
    const parts = [];
    if (pct('material')) parts.push('Material ' + pct('material'));
    if (pct('legal_review')) parts.push('needs legal review ' + pct('legal_review'));
    if (a.reviewer && a.reviewer.choice) parts.push('reviewer: ' + a.reviewer.choice);
    line.innerHTML = `${Arca.badge(r.processed_by || 'jev')} <span>${esc(parts.join(' · '))}</span> <span class="meta">${r.latency_ms != null ? Math.round(r.latency_ms) + ' ms' : ''}</span> <a class="link" id="jev-explain">Explain</a><div class="jev-state" id="jev-state" hidden>${esc(r.state_sent || '')}</div>`;
    const ex = $('#jev-explain');
    if (ex) ex.addEventListener('click', () => { const s = $('#jev-state'); if (s) s.hidden = !s.hidden; });
  }

  async function resolve(c, action) {
    resolved[c.field] = action;
    closeModal();
    if (!Arca.state.demoMode) {
      await Arca.api('/api/events', { method: 'POST', body: { action: action === 'approved' ? 'approved conflict' : 'requested clarification', doc_id: c.b && c.b.doc, result: c.field } });
    }
    Arca.emit('conflict:resolved', { field: c.field, action });
    Arca.toast(action === 'approved' ? `${c.field} approved · logged` : `Clarification requested on ${c.field} · logged`);
    renderExtraction();
    renderSidebar();
    renderDealroom();
  }

  // ---------- demo mode ----------
  function setDemo(on) {
    Arca.state.demoMode = !!on;
    const l = $('#live-label');
    if (l) l.innerHTML = on ? Arca.label('Demo mode', 'neutral') : Arca.label('Live', 'positive');
    Arca.emit('demo:toggle', { on: Arca.state.demoMode });
    Arca.toast(on ? 'Demo mode on · cached results, no network' : 'Live mode');
    if (!on) { docsKey = ''; refreshDocs(true); loadExtraction(); }
  }

  // ---------- events ----------
  function wire() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab],[data-filter],[data-user],[data-doc],[data-open],[data-conflict],[data-ask],#avatar,#invite-link,#btn-invite,#btn-upload');
      const menu = $('#role-menu');
      if (menu && !e.target.closest('.user-menu')) menu.hidden = true;
      if (!t) return;
      if (t.dataset.tab) return showTab(t.dataset.tab);
      if (t.dataset.filter) { filter = t.dataset.filter; showTab('dealroom'); renderSidebar(); return renderDealroom(); }
      if (t.dataset.user) { if (menu) menu.hidden = true; return switchUser(t.dataset.user); }
      if (t.dataset.open) { e.preventDefault(); const p = Number(t.dataset.page) || undefined; return openDoc(t.dataset.open, p ? { page: p, quote: t.dataset.quote || '' } : undefined); }
      if (t.dataset.conflict) return openConflict(t.dataset.conflict);
      if (t.dataset.doc) return openDoc(t.dataset.doc);
      if (t.dataset.ask) return ask(t.dataset.ask);
      if (t.id === 'avatar') { renderRoleMenu(); menu.hidden = !menu.hidden; return; }
      if (t.id === 'invite-link' || t.id === 'btn-invite') { e.preventDefault(); return Arca.emit('invite:open'); }
      if (t.id === 'btn-upload') { const fi = $('#file-input'); if (fi) fi.click(); }
    });

    document.addEventListener('change', (e) => {
      if (e.target.id === 'file-input' && e.target.files[0]) upload(e.target.files[0]);
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'doc-search') {
        query = e.target.value;
        const pos = e.target.selectionStart;
        renderDealroom();
        const s = $('#doc-search');
        if (s) { s.focus(); s.setSelectionRange(pos, pos); }
      }
    });
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'ask-form') { e.preventDefault(); const q = $('#ask-q'); ask(q && q.value.trim()); }
    });

    // whole table is the drop target
    let depth = 0;
    document.addEventListener('dragenter', (e) => { if (e.target.closest && e.target.closest('#tab-dealroom')) { depth++; const z = $('#drop-zone'); if (z) z.classList.add('dropping'); } });
    document.addEventListener('dragleave', (e) => { if (e.target.closest && e.target.closest('#tab-dealroom')) { depth = Math.max(0, depth - 1); if (!depth) { const z = $('#drop-zone'); if (z) z.classList.remove('dropping'); } } });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      const z = $('#drop-zone'); if (z) z.classList.remove('dropping');
      if (!e.target.closest || !e.target.closest('#tab-dealroom')) return;
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) upload(f);
    });

    document.addEventListener('keydown', (e) => {
      const typing = /input|textarea|select/i.test((e.target.tagName || '')) || e.target.isContentEditable;
      if (e.key === 'Escape') closeModal();
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'd' || e.key === 'D') setDemo(!Arca.state.demoMode);
    });

    Arca.on('share:changed', () => { docsKey = ''; refreshDocs(true); });
  }

  // ---------- boot ----------
  async function boot() {
    wire();
    const l = $('#live-label');
    if (l) l.innerHTML = Arca.label('Live', 'positive');
    if (/[?&]demo=1/.test(location.search)) Arca.state.demoMode = true;
    await ensureLogin();
    await loadData();
    const deal = Arca.data.deal || {};
    const crumb = $('#crumb');
    if (crumb && deal.district) crumb.textContent = `${deal.district} › Flat C, Tower 8B`;
    renderSidebar();
    renderRoleMenu();
    renderDealroom();
    renderExtraction();
    Arca.emit('ready');
    if (Arca.state.demoMode) setDemo(true);
    setInterval(() => refreshDocs(false), 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
