/* Arca document viewer (worker #5). Works with or without app.js. */
(function () {
  'use strict';
  window.Arca = window.Arca || {};
  var WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var S = null; // current session

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function jget(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) { var er = new Error('HTTP ' + r.status); er.status = r.status; throw er; }
      return r.json();
    });
  }
  function jpost(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : Promise.reject(new Error('HTTP ' + r.status)); });
  }
  function toast(msg, kind) { try { if (Arca.toast) Arca.toast(msg, kind); } catch (e) {} }
  function btn(label, primary) {
    var b = el('button', 'font:500 16px Inter,sans-serif;height:40px;padding:0 16px;border-radius:6px;cursor:pointer;transition:all 200ms ease;' +
      (primary ? 'background:var(--gold,#0059C8);color:#fff;border:1px solid var(--gold,#0059C8);' :
        'background:#fff;color:var(--text,#111B2B);border:1px solid var(--line,#E1E6EB);'), label);
    b.type = 'button';
    return b;
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  function mount() {
    var m = document.getElementById('doc-viewer');
    if (!m) { m = document.createElement('div'); m.id = 'doc-viewer'; document.body.appendChild(m); }
    return m;
  }

  function wmSvg(text) {
    var t = String(text || 'Arca').replace(/[<>&"]/g, '');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><text x="20" y="110" font-family="Inter,sans-serif" font-size="12" fill="#5B6474" transform="rotate(-30 160 100)">' + t + '</text></svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }

  function close() {
    try {
      if (!S) return;
      var s = S; S = null;
      document.removeEventListener('keydown', s.onKey, true);
      var ms = Date.now() - s.t0;
      var page = s.page || 1;
      var docId = s.docId;
      if (docId) {
        var body = { action: 'viewed', doc_id: docId, result: 'p.' + page + ' · ' + Math.round(ms / 1000) + 's' };
        jpost(s.guest ? '/api/guest/events' : '/api/events', body).catch(function () {});
      }
      try { Arca.emit && Arca.emit('doc:viewed', { docId: docId, page: page, ms: ms }); } catch (e) {}
      if (s.pdf && s.pdf.destroy) { try { s.pdf.destroy(); } catch (e) {} }
      if (s.io) { try { s.io.disconnect(); } catch (e) {} }
      var m = mount();
      m.style.opacity = '0';
      setTimeout(function () { if (!S) { m.style.display = 'none'; m.innerHTML = ''; } }, 200);
    } catch (e) {}
  }

  function open(opts) {
    try {
      opts = opts || {};
      if (S) close();
      var m = mount();
      m.innerHTML = '';
      m.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#fff;display:flex;flex-direction:column;opacity:0;transition:opacity 200ms ease;font-family:Inter,sans-serif;color:var(--text,#111B2B);';
      m.style.display = 'flex';
      requestAnimationFrame(function () { m.style.opacity = '1'; });

      var s = S = {
        docId: opts.docId || null, guest: !!opts.guest, t0: Date.now(), page: 1,
        opts: opts, boxes: {}, pages: [], drawMode: false, fallback: false
      };
      s.onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      document.addEventListener('keydown', s.onKey, true);

      var head = el('div', 'display:flex;align-items:center;gap:16px;padding:16px 24px;border-bottom:1px solid var(--line,#E1E6EB);flex:none;');
      var title = el('div', 'font:500 20px Inter,sans-serif;', opts.name || opts.docId || 'Document');
      var count = el('div', 'font:400 12px Inter,sans-serif;color:var(--muted,#5B6474);font-variant-numeric:tabular-nums;', '');
      var spacer = el('div', 'flex:1');
      head.appendChild(title); head.appendChild(count); head.appendChild(spacer);
      var tools = el('div', 'display:flex;gap:8px;');
      head.appendChild(tools);
      var x = el('button', 'width:40px;height:40px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:var(--muted,#5B6474);transition:all 200ms ease;');
      x.type = 'button'; x.setAttribute('aria-label', 'Close');
      x.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l12 12M16 4L4 16"/></svg>';
      x.onmouseenter = function () { x.style.background = 'var(--surface-2,#F0F3F5)'; };
      x.onmouseleave = function () { x.style.background = 'transparent'; };
      x.onclick = close;
      head.appendChild(x);
      m.appendChild(head);

      var scroller = el('div', 'flex:1;overflow:auto;background:var(--surface-2,#F0F3F5);padding:24px 16px;');
      var list = el('div', 'display:flex;flex-direction:column;align-items:center;gap:16px;');
      scroller.appendChild(list);
      m.appendChild(scroller);
      s.scroller = scroller; s.list = list; s.count = count; s.title = title;
      list.appendChild(el('div', 'font:400 14px Inter,sans-serif;color:var(--muted,#5B6474);padding:32px;', 'Loading document'));

      if (opts.mode === 'redact' && !s.guest) buildToolbar(s, tools);

      scroller.addEventListener('scroll', function () {
        if (!S) return;
        var mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 3, best = S.page;
        (S.pages || []).forEach(function (p) {
          var r = p.wrap.getBoundingClientRect();
          if (r.top <= mid && r.bottom > mid) best = p.n;
        });
        S.page = best;
        updateCount(S);
      });

      load(s).catch(function (e) { try { showText(s, null, 'Could not load this document.'); } catch (e2) {} });
    } catch (e) { try { console.warn('viewer', e); } catch (e2) {} }
  }

  function updateCount(s) {
    var n = s.numPages || (s.pages && s.pages.length) || 0;
    s.count.textContent = n ? 'Page ' + s.page + ' of ' + n : '';
  }

  function buildToolbar(s, tools) {
    var b = btn('Blackout', false);
    b.onclick = function () {
      s.drawMode = !s.drawMode;
      b.style.background = s.drawMode ? 'var(--surface-2,#F0F3F5)' : '#fff';
      b.style.borderColor = s.drawMode ? 'var(--text,#111B2B)' : 'var(--line,#E1E6EB)';
      (s.pages || []).forEach(function (p) { if (p.layer) p.layer.style.cursor = s.drawMode ? 'crosshair' : 'default'; });
    };
    var a = btn('Apply and share', true);
    a.onclick = function () { apply(s, a); };
    tools.appendChild(b); tools.appendChild(a);
  }

  function load(s) {
    var o = s.opts, meta = {};
    var base = s.guest ? '/api/guest/documents/' : '/api/documents/';
    var pm = Promise.resolve({});
    if (o.docId) pm = jget(base + encodeURIComponent(o.docId)).catch(function (e) {
      if (e.status === 403) throw e;
      var d = (window.Arca.data && window.Arca.data.documents) || [];
      var f = d.filter(function (x) { return x.id === o.docId; })[0];
      return f || {};
    });
    return pm.then(function (md) {
      meta = md || {};
      s.meta = meta;
      if (!o.name && meta.name) s.title.textContent = meta.name;
      s.watermark = o.watermark || meta.watermark || '';
      if (s.guest && meta.redacted && o.docId) return renderImages(s, meta);
      return renderPdf(s, meta);
    }).catch(function (e) {
      if (e && e.status === 403) { showText(s, null, 'You do not have access to this document.'); return; }
      throw e;
    });
  }

  function newPage(s, n, w, h) {
    var wrap = el('div', 'position:relative;background:#fff;width:' + w + 'px;height:' + h + 'px;flex:none;border:1px solid var(--line,#E1E6EB);');
    wrap.dataset.page = n;
    s.list.appendChild(wrap);
    return wrap;
  }

  function addOverlays(s, p) {
    // blackout boxes, then highlight slot, then watermark, then draw layer
    p.boxLayer = el('div', 'position:absolute;inset:0;pointer-events:none;');
    p.hlLayer = el('div', 'position:absolute;inset:0;pointer-events:none;');
    p.wm = el('div', 'position:absolute;inset:0;pointer-events:none;opacity:.15;background-image:' + wmSvg(s.watermark) + ';background-repeat:repeat;');
    p.layer = el('div', 'position:absolute;inset:0;cursor:' + (s.drawMode ? 'crosshair' : 'default') + ';');
    p.wrap.appendChild(p.boxLayer); p.wrap.appendChild(p.hlLayer); p.wrap.appendChild(p.wm); p.wrap.appendChild(p.layer);
    p.layer.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    if (s.opts.mode === 'redact' && !s.guest) wireDraw(s, p);
  }

  function boxEl(s, p, b) {
    var d = el('div', 'position:absolute;background:#111B2B;left:' + b.x * p.k + 'px;top:' + b.y * p.k + 'px;width:' + b.w * p.k + 'px;height:' + b.h * p.k + 'px;');
    d._b = b;
    return d;
  }

  function wireDraw(s, p) {
    var L = p.layer, tmp = null, sx = 0, sy = 0;
    p.boxLayer.style.pointerEvents = 'none';
    L.addEventListener('mousedown', function (e) {
      if (!s.drawMode) return;
      var r = L.getBoundingClientRect();
      sx = e.clientX - r.left; sy = e.clientY - r.top;
      tmp = el('div', 'position:absolute;background:#111B2B;opacity:.6;left:' + sx + 'px;top:' + sy + 'px;width:0;height:0;');
      L.appendChild(tmp);
      var mv = function (ev) {
        var cx = Math.max(0, Math.min(r.width, ev.clientX - r.left)), cy = Math.max(0, Math.min(r.height, ev.clientY - r.top));
        tmp.style.left = Math.min(sx, cx) + 'px'; tmp.style.top = Math.min(sy, cy) + 'px';
        tmp.style.width = Math.abs(cx - sx) + 'px'; tmp.style.height = Math.abs(cy - sy) + 'px';
      };
      var up = function () {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        var w = parseFloat(tmp.style.width), h = parseFloat(tmp.style.height);
        var l = parseFloat(tmp.style.left), t = parseFloat(tmp.style.top);
        tmp.remove(); tmp = null;
        if (w < 4 || h < 4) return;
        var b = { page: p.n, x: l / p.k, y: t / p.k, w: w / p.k, h: h / p.k };
        s.boxes[p.n] = s.boxes[p.n] || [];
        s.boxes[p.n].push(b);
        var d = boxEl(s, p, b);
        d.style.pointerEvents = 'auto'; d.style.cursor = 'pointer'; d.title = 'Click to remove';
        d.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
        d.addEventListener('click', function (ev) {
          ev.stopPropagation();
          s.boxes[p.n] = s.boxes[p.n].filter(function (q) { return q !== b; });
          d.remove();
        });
        p.boxLayer.style.pointerEvents = 'none';
        L.appendChild(d); // keep clickable above the layer
      };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  }

  function setupPdfJs() {
    if (typeof pdfjsLib === 'undefined') return false;
    try { if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; } catch (e) {}
    return true;
  }

  function fitWidth(s) {
    var avail = Math.max(280, s.scroller.clientWidth - 32);
    return Math.min(900, avail);
  }

  function renderPdf(s, meta) {
    var o = s.opts;
    if (!setupPdfJs()) return fallbackText(s, meta);
    var srcP;
    if (o.bytes) srcP = Promise.resolve({ data: o.bytes instanceof ArrayBuffer ? new Uint8Array(o.bytes.slice(0)) : o.bytes });
    else {
      var url = o.src || ((s.guest ? '/api/guest/documents/' : '/api/documents/') + encodeURIComponent(o.docId) + '/file');
      srcP = fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('file ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) { return { data: new Uint8Array(buf) }; });
    }
    return srcP.then(function (src) { return pdfjsLib.getDocument(src).promise; }).then(function (pdf) {
      s.pdf = pdf; s.numPages = pdf.numPages;
      s.list.innerHTML = '';
      updateCount(s);
      var dpr = window.devicePixelRatio || 1, W = fitWidth(s), chain = Promise.resolve();
      var hl = o.highlight && o.highlight.quote ? norm(o.highlight.quote) : '';
      var hlDone = false;
      var hlPage = o.highlight && o.highlight.page ? o.highlight.page : 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        chain = chain.then(function () {
          if (!S || S !== s) return;
          return pdf.getPage(n).then(function (page) {
            var v1 = page.getViewport({ scale: 1 });
            var k = W / v1.width, vp = page.getViewport({ scale: k });
            var wrap = newPage(s, n, vp.width, vp.height);
            var cv = document.createElement('canvas');
            cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
            cv.style.cssText = 'display:block;width:' + vp.width + 'px;height:' + vp.height + 'px;';
            cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
            wrap.appendChild(cv);
            var p = { n: n, wrap: wrap, canvas: cv, k: k, pw: v1.width, ph: v1.height };
            s.pages.push(p);
            addOverlays(s, p);
            var ctx = cv.getContext('2d');
            var rt = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: k * dpr }) }).promise;
            var hp = Promise.resolve();
            if (hl && !hlDone && (!hlPage || hlPage === n)) {
              hp = page.getTextContent().then(function (tc) {
                var rects = findQuote(tc, hl, vp);
                if (rects.length) {
                  hlDone = true;
                  rects.forEach(function (r) {
                    p.hlLayer.appendChild(el('div', 'position:absolute;background:#FFF4C2;mix-blend-mode:multiply;left:' + (r.x - 2) + 'px;top:' + (r.y - 1) + 'px;width:' + (r.w + 4) + 'px;height:' + (r.h + 2) + 'px;'));
                  });
                  setTimeout(function () { try { wrap.scrollIntoView({ block: 'start' }); s.scroller.scrollTop += rects[0].y - 120; } catch (e) {} }, 60);
                }
              }).catch(function () {});
            }
            return Promise.all([rt, hp]).catch(function () {});
          });
        });
      }
      return chain;
    }).catch(function (e) {
      if (!S || S !== s) return;
      if (s.pages.length) return; // partial render is fine
      return fallbackText(s, meta);
    });
  }

  function findQuote(tc, q, vp) {
    var items = tc.items.filter(function (i) { return i.str != null; });
    var full = '', map = [], prevSpace = true;
    items.forEach(function (it, idx) {
      var str = it.str.toLowerCase();
      for (var i = 0; i < str.length; i++) {
        var c = str[i];
        if (/\s/.test(c)) { if (!prevSpace) { full += ' '; map.push(idx); prevSpace = true; } }
        else { full += c; map.push(idx); prevSpace = false; }
      }
      if (!prevSpace) { full += ' '; map.push(idx); prevSpace = true; }
    });
    var at = full.indexOf(q);
    if (at < 0 && q.length > 40) { q = q.slice(0, 40).trim(); at = full.indexOf(q); }
    if (at < 0) return [];
    var seen = {}, rects = [];
    for (var j = at; j < at + q.length && j < map.length; j++) {
      if (seen[map[j]]) continue; seen[map[j]] = 1;
      var it = items[map[j]];
      if (!it.str.trim()) continue;
      var tx = pdfjsLib.Util.transform(vp.transform, it.transform);
      var h = Math.hypot(tx[2], tx[3]) || (it.height * vp.scale) || 10;
      var w = it.width * vp.scale;
      rects.push({ x: tx[4], y: tx[5] - h * 0.85, w: w, h: h * 1.05 });
    }
    return rects;
  }

  function renderImages(s, meta) {
    s.list.innerHTML = '';
    var n = meta.pages || 1; s.numPages = n; updateCount(s);
    var W = fitWidth(s), loads = [];
    for (let i = 1; i <= n; i++) {
      loads.push(new Promise(function (res) {
        var img = new Image();
        img.draggable = false;
        img.onload = function () {
          var h = W * img.naturalHeight / img.naturalWidth;
          var wrap = newPage(s, i, W, h);
          img.style.cssText = 'display:block;width:100%;height:100%;';
          img.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          wrap.appendChild(img);
          var p = { n: i, wrap: wrap, k: 1 };
          s.pages.push(p); addOverlays(s, p); res();
        };
        img.onerror = function () { res(); };
        img.src = '/api/guest/documents/' + encodeURIComponent(s.docId) + '/page/' + i;
      }));
    }
    return Promise.all(loads).then(function () {
      s.pages.sort(function (a, b) { return a.n - b.n; });
      s.pages.forEach(function (p) { s.list.appendChild(p.wrap); });
    });
  }

  function fallbackText(s, meta) {
    s.fallback = true;
    var done = function (text) { showText(s, text); };
    if (meta && meta.text) return done(meta.text);
    if (s.opts.docId) {
      return jget((s.guest ? '/api/guest/documents/' : '/api/documents/') + encodeURIComponent(s.opts.docId))
        .then(function (d) { done(d.text || ''); }).catch(function () { done(''); });
    }
    return done('');
  }

  function showText(s, text, msg) {
    if (!S || S !== s) return;
    s.list.innerHTML = '';
    s.pages = [];
    if (!text) {
      s.list.appendChild(el('div', 'font:400 16px Inter,sans-serif;color:var(--muted,#5B6474);padding:32px;', msg || 'No preview available for this document.'));
      return;
    }
    var parts = String(text).split(/^=== Page (\d+) ===\s*$/m), pages = [];
    if (parts.length < 3) pages.push({ n: 1, t: text });
    else for (var i = 1; i < parts.length; i += 2) pages.push({ n: +parts[i], t: parts[i + 1] || '' });
    s.numPages = pages.length;
    var q = s.opts.highlight && s.opts.highlight.quote ? norm(s.opts.highlight.quote) : '';
    var first = null;
    pages.forEach(function (pg) {
      var w = el('div', 'position:relative;background:#fff;width:' + fitWidth(s) + 'px;max-width:100%;border:1px solid var(--line,#E1E6EB);padding:32px;box-sizing:border-box;overflow:hidden;');
      var pre = el('div', 'position:relative;font:400 14px/1.6 Inter,sans-serif;white-space:pre-wrap;');
      var t = pg.t.trim(), lower = t.toLowerCase(), at = q ? lower.indexOf(q) : -1;
      if (at >= 0) {
        pre.appendChild(document.createTextNode(t.slice(0, at)));
        var mk = el('span', 'background:#FFF4C2;', t.slice(at, at + q.length));
        pre.appendChild(mk); first = first || mk;
        pre.appendChild(document.createTextNode(t.slice(at + q.length)));
      } else pre.textContent = t;
      w.appendChild(pre);
      w.appendChild(el('div', 'position:absolute;inset:0;pointer-events:none;opacity:.15;background-image:' + wmSvg(s.watermark) + ';'));
      w.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      w.dataset.page = pg.n;
      s.list.appendChild(w);
      s.pages.push({ n: pg.n, wrap: w });
    });
    updateCount(s);
    if (first) setTimeout(function () { try { first.scrollIntoView({ block: 'center' }); } catch (e) {} }, 60);
  }

  function apply(s, button) {
    try {
      if (!s.pages.length || s.fallback || !s.pages[0].canvas) { toast('Blackout needs the PDF view', 'error'); return; }
      var all = [];
      var pages = s.pages.map(function (p) {
        var c = document.createElement('canvas');
        c.width = p.canvas.width; c.height = p.canvas.height;
        var x = c.getContext('2d');
        x.drawImage(p.canvas, 0, 0);
        x.fillStyle = '#111B2B';
        var f = c.width / p.pw;
        (s.boxes[p.n] || []).forEach(function (b) {
          x.fillRect(b.x * f, b.y * f, b.w * f, b.h * f);
          all.push({ page: b.page, x: b.x, y: b.y, w: b.w, h: b.h });
        });
        return { n: p.n, png_base64: c.toDataURL('image/png').split(',')[1] };
      });
      if (!all.length) { toast('Draw at least one blackout box first', 'error'); return; }
      button.disabled = true; button.style.opacity = '.6'; button.textContent = 'Applying';
      var docId = s.docId, shareTo = s.opts.shareTo;
      jpost('/api/documents/' + encodeURIComponent(docId) + '/redactions', { pages: pages, boxes: all })
        .then(function () {
          if (shareTo) return jpost('/api/share', { clientEmail: shareTo, docId: docId, shared: true });
        })
        .then(function () {
          try { Arca.emit && Arca.emit('share:changed', { docId: docId, clientEmail: shareTo, shared: !!shareTo, redacted: true }); } catch (e) {}
          toast(shareTo ? 'Blacked out ' + all.length + ' area' + (all.length > 1 ? 's' : '') + ' and shared' : 'Blackout applied');
          close();
        })
        .catch(function () {
          button.disabled = false; button.style.opacity = '1'; button.textContent = 'Apply and share';
          toast('Could not apply blackout', 'error');
        });
    } catch (e) { toast('Could not apply blackout', 'error'); }
  }

  Arca.viewer = { open: open, close: close };
})();
