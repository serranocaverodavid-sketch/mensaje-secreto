(function () {
  'use strict';
  const C = window.Cipher;
  const $ = id => document.getElementById(id);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { mode: 'original', dir: 'enc', out: '', raf: 0, rot: 0, note: '' };
  const el = {
    input: $('input'), output: $('output'), status: $('status'), trace: $('trace'), tiles: $('tiles'),
    panelIn: $('panelIn'), panelOut: $('panelOut'), langIn: $('langIn'), langOut: $('langOut'),
    tagIn: $('tagIn'), tagOut: $('tagOut'), dirLabel: $('dirLabel'), countIn: $('countIn'), countOut: $('countOut'),
    swap: $('swap'), search: $('search'), toast: $('toast')
  };

  const LABELS = {
    text: { lang: 'Español', tag: 'texto normal' },
    code: { lang: 'Romano', tag: 'código secreto' }
  };
  const table = () => C.TABLES[state.mode];

  /* ---------------- traducción ---------------- */
  function update(opts) {
    const animate = opts && opts.animate;
    cancelAnimationFrame(state.raf);
    const tbl = table();
    const text = el.input.value;
    const r = state.dir === 'enc' ? C.encode(text, tbl) : C.decode(text, tbl);
    state.out = r.out;
    if (animate && r.out) reveal(r.out); else el.output.textContent = r.out;
    el.countIn.textContent = text ? text.length + ' caracteres' : '';
    el.countOut.textContent = r.out ? r.out.length + ' caracteres' : '';
    renderTrace(r.toks);
    renderStatus(r.toks, text);
  }

  function reveal(finalText) {
    if (reduce) { el.output.textContent = finalText; return; }
    const pool = 'ABCDEFGHJKMNPRSTUVXYZ#$%&?';
    const ms = Math.min(1600, 500 + finalText.length * 12);
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / ms);
      const k = Math.floor(p * finalText.length);
      let s = finalText.slice(0, k);
      for (let i = k; i < finalText.length; i++) s += /\s/.test(finalText[i]) ? finalText[i] : pool[(Math.random() * pool.length) | 0];
      el.output.textContent = s;
      if (p < 1) state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }

  function renderTrace(toks) {
    const MAX = 60;
    const frag = document.createDocumentFragment();
    let shown = 0, total = 0;
    toks.forEach(t => { if (!t.ws || t.space) total++; });
    for (const t of toks) {
      if (shown >= MAX) break;
      const chip = document.createElement('div');
      chip.style.setProperty('--i', shown);
      if (t.ws && t.space) {
        // un espacio se escribe "--"
        chip.className = 'chip sp';
        const b = document.createElement('b'); b.textContent = '␣';
        const i = document.createElement('i'); i.textContent = '--';
        chip.append(b, i);
        shown++;
      } else if (t.ws) {
        chip.className = 'chip gap';
      } else {
        chip.className = 'chip ' + t.flag;
        const top = state.dir === 'enc' ? t.src : t.out;
        const bottom = state.dir === 'enc' ? t.out : t.src;
        const b = document.createElement('b'); b.textContent = top;
        const i = document.createElement('i'); i.textContent = bottom;
        chip.append(b, i);
        shown++;
      }
      frag.appendChild(chip);
    }
    if (total > MAX) {
      const more = document.createElement('div');
      more.className = 'chip more'; more.style.setProperty('--i', MAX);
      more.textContent = '+' + (total - MAX) + ' más';
      frag.appendChild(more);
    }
    el.trace.replaceChildren(frag);
  }

  function pill(cls, html) {
    const s = document.createElement('span');
    s.className = 'pill ' + cls; s.innerHTML = html; return s;
  }
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderStatus(toks, text) {
    const frag = document.createDocumentFragment();
    const none = new Set();
    const dup = new Map();
    for (const t of toks) {
      if (t.ws) continue;
      if (t.flag === 'none') none.add(t.src);
      else if (t.flag === 'dup' && state.dir === 'enc' && t.back !== t.src) dup.set(t.src, t.back);
    }
    if (state.note) frag.appendChild(pill('info', esc(state.note)));

    if (none.size) {
      const list = [...none].slice(0, 8).map(c => '<b>' + esc(c) + '</b>').join(' ');
      frag.appendChild(pill('warn', state.dir === 'enc'
        ? 'Sin código en esta tabla (se quedan igual): ' + list
        : 'No reconocido (se deja igual): ' + list));
    }
    if (dup.size) {
      const list = [...dup].slice(0, 6).map(([a, b]) => '<b>' + esc(a) + '</b>→<b>' + esc(b) + '</b>').join(' ');
      frag.appendChild(pill('dup', 'Código repetido, al descifrar vuelve otro carácter: ' + list));
    }
    if (text.trim() && !none.size && !dup.size && !state.note) {
      frag.appendChild(pill('ok', '✓ Traducción reversible'));
    }

    // sugerencia automática de dirección
    if (text.trim()) {
      if (state.dir === 'enc' && /-/.test(text) && C.looksLikeCode(text)) {
        frag.appendChild(suggest('Esto parece código secreto → Descifrar', 'dec'));
      } else if (state.dir === 'dec' && !C.looksLikeCode(text)) {
        frag.appendChild(suggest('Esto parece texto normal → Cifrar', 'enc'));
      }
    }
    el.status.replaceChildren(frag);
  }

  function suggest(label, dir) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pill info'; b.textContent = '💡 ' + label;
    b.addEventListener('click', () => { setDir(dir); update({ animate: true }); });
    return b;
  }

  /* ---------------- dirección / swap ---------------- */
  function setDir(dir) {
    state.dir = dir;
    const enc = dir === 'enc';
    const inL = enc ? LABELS.text : LABELS.code;
    const outL = enc ? LABELS.code : LABELS.text;
    el.langIn.textContent = inL.lang; el.tagIn.textContent = inL.tag;
    el.langOut.textContent = outL.lang; el.tagOut.textContent = outL.tag;
    el.panelIn.classList.toggle('is-code', !enc);
    el.panelOut.classList.toggle('is-code', enc);
    el.dirLabel.textContent = enc ? 'Español → Romano' : 'Romano → Español';
    el.input.placeholder = enc ? 'Escribe aquí…' : 'Pega aquí el código, p. ej. XV-XXXII-XXIV-II';
    el.output.dataset.ph = enc ? 'El código aparecerá aquí' : 'El texto aparecerá aquí';
    renderTiles();
  }

  el.swap.addEventListener('click', () => {
    state.rot += 180;
    el.swap.style.setProperty('--rot', state.rot + 'deg');
    const carry = state.out;
    state.note = '';
    setDir(state.dir === 'enc' ? 'dec' : 'enc');
    el.input.value = carry;
    update({ animate: true });
  });

  /* ---------------- entrada ---------------- */
  el.input.addEventListener('input', () => { state.note = ''; update(); });
  $('clear').addEventListener('click', () => { el.input.value = ''; state.note = ''; update(); el.input.focus(); });

  $('demoHola').addEventListener('click', () => {
    state.note = ''; setDir('enc'); el.input.value = 'Hola'; update({ animate: true });
  });

  $('demoSecret').addEventListener('click', () => {
    setDir('dec');
    el.input.value = C.SECRET;
    state.note = '';
    update({ animate: true });
    const r = $('panelOut').getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 3);
    $('panelOut').scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  });

  $('copy').addEventListener('click', async () => {
    if (!state.out) return toast('No hay nada que copiar');
    try { await navigator.clipboard.writeText(state.out); toast('Copiado ✓'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = state.out; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); toast('Copiado ✓'); } catch (_) { toast('No se pudo copiar'); }
      ta.remove();
    }
  });

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  /* ---------------- tabla de referencia ---------------- */
  el.search.addEventListener('input', renderTiles);

  function renderTiles() {
    const tbl = table();
    const q = el.search.value.trim().toLowerCase();
    const qUp = q.toUpperCase();
    let items = tbl.pairs.map(([ch, code]) => ({
      ch, code, flag: tbl.amb.has(code) ? 'dup' : ''
    }));
    items.push({ ch: '␣', name: 'espacio', code: '--', flag: '', space: true });
    if (q) items = items.filter(t => t.ch.toLowerCase().includes(q) || (t.name && t.name.includes(q)) || (t.code && t.code.includes(qUp)));

    const groups = {};
    for (const t of items) (groups[C.groupOf(t.ch)] = groups[C.groupOf(t.ch)] || []).push(t);

    const frag = document.createDocumentFragment();
    let i = 0;
    for (const name of ['Letras', 'Acentos', 'Números', 'Símbolos']) {
      if (!groups[name]) continue;
      const sec = document.createElement('div'); sec.className = 'group';
      const h = document.createElement('h3'); h.textContent = name;
      const grid = document.createElement('div'); grid.className = 'tiles';
      groups[name].forEach(t => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tile ' + t.flag; b.style.setProperty('--i', i++);
        b.title = t.code ? (t.name || t.ch) + ' = ' + t.code : t.ch + ': sin código';
        const ch = document.createElement('span'); ch.className = 'ch'; ch.textContent = t.ch;
        const cd = document.createElement('span'); cd.className = 'cd'; cd.textContent = t.code || '—';
        b.append(ch, cd);
        b.addEventListener('click', () => insertFromTile(t));
        grid.appendChild(b);
      });
      sec.append(h, grid); frag.appendChild(sec);
    }
    if (!items.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nada coincide con «' + el.search.value + '».'; frag.appendChild(p); }
    el.tiles.replaceChildren(frag);
  }

  function insertFromTile(t) {
    state.note = '';
    const cur = el.input.value;
    if (t.space) {
      el.input.value = cur + (state.dir === 'enc' ? ' ' : '--');
    } else if (state.dir === 'enc') {
      el.input.value = cur + t.ch;
    } else {
      if (!t.code) return toast('Esa tecla no tiene código');
      el.input.value = cur + (cur && !/[\s-]$/.test(cur) ? '-' : '') + t.code;
    }
    update(); el.input.focus();
  }

  /* ---------------- efectos visuales ---------------- */
  document.addEventListener('pointermove', e => {
    const card = e.target.closest && e.target.closest('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  // Lluvia de números romanos
  (function rain() {
    const c = $('rain'), x = c.getContext('2d');
    const size = 18, glyphs = 'IVXLC';
    let cols = 0, drops = [], dpr = 1, last = 0;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = innerWidth * dpr; c.height = innerHeight * dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(innerWidth / size);
      drops = Array.from({ length: cols }, () => Math.random() * -40);
    }
    function frame(now) {
      requestAnimationFrame(frame);
      if (now - last < 55) return; last = now;
      x.globalCompositeOperation = 'destination-out';
      x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(0, 0, innerWidth, innerHeight);
      x.globalCompositeOperation = 'source-over';
      x.font = '600 ' + (size - 3) + 'px "JetBrains Mono", monospace';
      for (let i = 0; i < cols; i++) {
        const y = drops[i] * size;
        x.fillStyle = Math.random() > .975 ? '#fbbf24' : (i % 6 === 0 ? '#e879f9' : '#22d3ee');
        if (y > 0) x.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * size, y);
        if (y > innerHeight && Math.random() > .96) drops[i] = Math.random() * -12;
        drops[i] += 1;
      }
    }
    resize(); window.addEventListener('resize', resize);
    if (reduce) { for (let k = 0; k < 40; k++) frame(k * 100); } else requestAnimationFrame(frame);
  })();

  // Explosión de números romanos al descifrar el mensaje
  function burst(x0, y0) {
    if (reduce) return;
    const c = $('burst'), g = c.getContext('2d');
    c.width = innerWidth; c.height = innerHeight;
    const cols = ['#22d3ee', '#e879f9', '#fbbf24', '#e8f0ff'];
    const parts = Array.from({ length: 90 }, () => ({
      x: x0, y: y0, vx: (Math.random() - .5) * 16, vy: -Math.random() * 14 - 3, life: 1,
      ch: 'IVXLCDM'[(Math.random() * 7) | 0], col: cols[(Math.random() * cols.length) | 0],
      s: 14 + Math.random() * 18, rot: Math.random() * 6, vr: (Math.random() - .5) * .3
    }));
    (function step() {
      g.clearRect(0, 0, c.width, c.height);
      let alive = false;
      for (const p of parts) {
        p.vy += .32; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= .012;
        if (p.life <= 0) continue;
        alive = true;
        g.save(); g.globalAlpha = Math.max(p.life, 0); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.col; g.font = '700 ' + p.s + 'px Cinzel, serif'; g.fillText(p.ch, 0, 0); g.restore();
      }
      if (alive) requestAnimationFrame(step); else g.clearRect(0, 0, c.width, c.height);
    })();
  }

  /* ---------------- arranque ---------------- */
  setDir('enc');
  el.input.value = 'Hola a todos';
  update();
})();
