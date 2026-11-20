/*
 * Sala (proyector), modo concurso: recoge los nombres y lanza rondas rápidas.
 * En cada ronda sale una palabra corta en código romano; los móviles eligen entre
 * 4 opciones. Cuanto antes aciertas, más puntos. Al final, podio.
 */
(function () {
  'use strict';
  const { connect, pub, parse, T, roomCode, store, confetti } = window.Red;
  const { encode, TABLES } = window.Cipher;
  const TBL = TABLES.original;
  const $ = (id) => document.getElementById(id);
  const KEY = 'ms_sala_quiz';
  const LIMIT = 20000; // ms por ronda
  const ROUNDS = 6;

  // Palabras cortas por longitud (sin tildes, todas en minúscula).
  const WORDS = {
    3: ['sol', 'mar', 'pan', 'oso', 'ojo', 'rey', 'sal', 'pez', 'gol', 'mes', 'luz'],
    4: ['gato', 'hola', 'casa', 'luna', 'mesa', 'pato', 'lobo', 'rosa', 'taza', 'nube', 'pelo', 'vaca'],
    5: ['perro', 'pizza', 'clase', 'libro', 'playa', 'fuego', 'queso', 'tigre', 'regla', 'silla', 'mango', 'nieve'],
    6: ['recreo', 'helado', 'cohete', 'pirata', 'tomate', 'dragon', 'patata', 'abuela', 'conejo', 'maleta']
  };
  const PLAN = [3, 3, 4, 4, 5, 6];
  const COLORS = ['c0', 'c1', 'c2', 'c3'];
  const SHAPES = ['▲', '◆', '●', '■'];

  let client = null;
  let tick = null;

  const fresh = () => ({
    room: roomCode(), phase: 'lobby', players: [], scores: {},
    round: 0, q: null, qStart: 0, answers: {}, gains: {}, used: []
  });
  let S = store.get(KEY) || fresh();

  const nameOf = (id) => (S.players.find((p) => p.id === id) || {}).name || '¿?';
  const save = () => store.set(KEY, S);
  // Lo que ven los móviles. Durante la pregunta no se manda la respuesta correcta.
  function publicState() {
    const q = S.q && {
      code: S.q.code, options: S.q.options, len: S.q.word.length,
      correct: S.phase === 'question' ? null : S.q.correct
    };
    return {
      room: S.room, phase: S.phase, players: S.players, scores: S.scores,
      round: S.round, rounds: ROUNDS, q, qStart: S.qStart, limit: LIMIT, gains: S.gains
    };
  }
  const publish = () => { if (client) pub(client, T.state(S.room), publicState(), true); };
  const commit = () => { save(); publish(); render(); };

  function joinUrl() {
    const u = new URL('jugar.html', location.href);
    u.search = '?sala=' + S.room;
    return u.toString();
  }

  // ---------- red ----------
  function setNet(st) {
    const map = {
      ok: ['', 'Conectado'], reconnecting: ['warn', 'Reconectando…'], offline: ['off', 'Sin conexión'],
      slow: ['off', 'No conecta: esta red bloquea el juego. Conecta el portátil a los datos del móvil.']
    };
    const [cls, txt] = map[st] || map.offline;
    const d = document.createElement('span');
    d.className = 'dot ' + cls;
    $('net').replaceChildren(d, txt);
  }

  function onUp(m) {
    if (!m || !m.id) return;
    if (m.t === 'join') {
      const name = String(m.name || '').trim().slice(0, 18);
      if (!name) return;
      const me = S.players.find((p) => p.id === m.id);
      if (me) { me.name = name; commit(); return; }
      let final = name;
      let k = 2;
      while (S.players.some((p) => p.name.toLowerCase() === final.toLowerCase())) final = `${name} ${k++}`;
      S.players.push({ id: m.id, name: final });
      S.scores[m.id] = S.scores[m.id] || 0;
      commit();
    } else if (m.t === 'leave' && S.phase === 'lobby') {
      S.players = S.players.filter((p) => p.id !== m.id);
      commit();
    } else if (m.t === 'answer' && S.phase === 'question' && m.round === S.round) {
      if (S.answers[m.id] || !S.players.some((p) => p.id === m.id)) return;
      const c = Number(m.choice);
      if (!(c >= 0 && c < 4)) return;
      S.answers[m.id] = { c, ms: Date.now() - S.qStart };
      save();
      renderCount();
      if (Object.keys(S.answers).length >= S.players.length) reveal();
    }
  }

  // ---------- rondas ----------
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function makeQuestion(n) {
    const len = PLAN[Math.min(n - 1, PLAN.length - 1)];
    const bank = WORDS[len];
    const fresh = bank.filter((w) => !S.used.includes(w));
    const word = pick(fresh.length ? fresh : bank);
    S.used.push(word);
    const others = shuffle(bank.filter((w) => w !== word)).slice(0, 3);
    const options = shuffle([word, ...others]);
    return { word, code: encode(word, TBL).out, options, correct: options.indexOf(word) };
  }

  function ask() {
    S.round += 1;
    S.q = makeQuestion(S.round);
    S.answers = {};
    S.gains = {};
    S.phase = 'question';
    S.qStart = Date.now();
    commit();
  }

  function reveal() {
    if (S.phase !== 'question') return;
    S.gains = {};
    for (const [id, a] of Object.entries(S.answers)) {
      if (a.c === S.q.correct) {
        const g = Math.max(500, Math.round(1000 - 500 * (a.ms / LIMIT)));
        S.gains[id] = g;
        S.scores[id] = (S.scores[id] || 0) + g;
      }
    }
    S.phase = 'reveal';
    commit();
    if (Object.keys(S.gains).length) confetti($('burst'), 70);
  }

  function next() {
    if (S.round >= ROUNDS) {
      S.phase = 'end';
      commit();
      confetti($('burst'), 260);
    } else {
      ask();
    }
  }

  function again() {
    if (client) pub(client, T.state(S.room), null, true);
    S = fresh();
    $('chips').innerHTML = '';
    save();
    announce();
    publish();
    render();
  }

  function announce() {
    if (!client) return;
    pub(client, T.actual, { room: S.room, at: Date.now() }, true);
    client.subscribe(T.up(S.room), { qos: 1 });
    drawQR();
  }

  // ---------- pintar ----------
  function drawQR() {
    const box = $('qr');
    box.innerHTML = '';
    if (window.QRCode) {
      new window.QRCode(box, {
        text: joinUrl(), width: 512, height: 512,
        colorDark: '#07091a', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M
      });
    }
    $('code').textContent = S.room;
  }

  function renderLobby() {
    const chips = $('chips');
    const ids = new Set(S.players.map((p) => p.id));
    for (const el of [...chips.children]) if (!ids.has(el.dataset.id)) el.remove();
    for (const p of S.players) {
      let el = chips.querySelector(`[data-id="${p.id}"]`);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'chip';
        el.dataset.id = p.id;
        el.title = 'Quitar a ' + p.name;
        el.addEventListener('click', () => {
          S.players = S.players.filter((x) => x.id !== p.id);
          delete S.scores[p.id];
          commit();
        });
        const n = document.createElement('span');
        const x = document.createElement('span');
        x.className = 'x';
        x.textContent = '✕';
        el.append(n, x);
        chips.append(el);
      }
      el.firstChild.textContent = p.name;
    }
    $('count').textContent = S.players.length;
    $('empty').hidden = S.players.length > 0;
    $('start').disabled = S.players.length < 1;
  }

  function optionEls(box, withCounts) {
    box.innerHTML = '';
    const counts = [0, 0, 0, 0];
    for (const a of Object.values(S.answers)) counts[a.c]++;
    S.q.options.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'opt ' + COLORS[i];
      if (withCounts) d.classList.add(i === S.q.correct ? 'right' : 'wrong');
      const s = document.createElement('span');
      s.className = 'shape';
      s.textContent = SHAPES[i];
      const t = document.createElement('span');
      t.className = 'w';
      t.textContent = w;
      d.append(s, t);
      if (withCounts) {
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = counts[i] + (i === S.q.correct ? ' ✓' : '');
        d.append(n);
      }
      box.append(d);
    });
  }

  function renderHint() {
    const box = $('hint');
    if (box.childElementCount) return;
    for (const ch of 'abcdefghijklmnñopqrstuvwxyz') {
      const d = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = ch;
      const s = document.createElement('span');
      s.textContent = TBL.enc.get(ch);
      d.append(b, s);
      box.append(d);
    }
  }

  function renderCount() {
    $('answered').textContent = `Respuestas: ${Object.keys(S.answers).length} / ${S.players.length}`;
  }

  function sortedPlayers() {
    return [...S.players].sort((a, b) => (S.scores[b.id] || 0) - (S.scores[a.id] || 0));
  }

  function rankItem(i, p, extra) {
    const li = document.createElement('li');
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = ['🥇', '🥈', '🥉'][i] || String(i + 1);
    const n = document.createElement('span');
    n.textContent = p.name;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = (S.scores[p.id] || 0) + ' pts';
    li.append(pos, n);
    if (extra) {
      const g = document.createElement('span');
      g.className = 'gain';
      g.textContent = extra;
      li.append(g);
    }
    li.append(t);
    return li;
  }

  function renderReveal() {
    $('revCode').textContent = S.q.code;
    $('revWord').textContent = S.q.word;
    optionEls($('optsR'), true);
    const ol = $('board');
    ol.innerHTML = '';
    sortedPlayers().slice(0, 6).forEach((p, i) => ol.append(rankItem(i, p, S.gains[p.id] ? '+' + S.gains[p.id] : '')));
  }

  function renderFinal() {
    const top = sortedPlayers();
    const pod = $('podium3');
    pod.innerHTML = '';
    [1, 0, 2].forEach((k) => {
      const p = top[k];
      if (!p) return;
      const d = document.createElement('div');
      d.className = 'step s' + (k + 1);
      const m = document.createElement('div');
      m.className = 'medal';
      m.textContent = ['🥇', '🥈', '🥉'][k];
      const n = document.createElement('div');
      n.className = 'pn';
      n.textContent = p.name;
      const sc = document.createElement('div');
      sc.className = 'ps';
      sc.textContent = (S.scores[p.id] || 0) + ' pts';
      const block = document.createElement('div');
      block.className = 'block';
      block.textContent = k + 1;
      d.append(m, n, sc, block);
      pod.append(d);
    });
    const ol = $('finalRank');
    ol.innerHTML = '';
    top.slice(3).forEach((p, i) => ol.append(rankItem(i + 3, p)));
  }

  function render() {
    const ph = S.phase;
    $('lobby').hidden = ph !== 'lobby';
    $('question').hidden = ph !== 'question';
    $('reveal').hidden = ph !== 'reveal';
    $('final').hidden = ph !== 'end';
    $('start').hidden = ph !== 'lobby';
    $('skip').hidden = ph !== 'question';
    $('next').hidden = ph !== 'reveal';
    $('next').textContent = S.round >= ROUNDS ? 'Ver podio 🏆' : 'Siguiente ronda ▶';
    $('again').hidden = ph !== 'end';
    $('answered').hidden = ph !== 'question';

    const titles = {
      lobby: ['El juego del mensaje secreto', '<span class="grad">¡A jugar!</span>'],
      question: [`Ronda ${S.round} de ${ROUNDS}`, 'Descifra la palabra… <span class="grad">¡rápido!</span>'],
      reveal: [`Ronda ${S.round} de ${ROUNDS}`, 'Era…'],
      end: ['Fin de la partida', '<span class="grad">¡Podio final!</span>']
    };
    $('eyebrow').textContent = titles[ph][0];
    $('title').innerHTML = titles[ph][1];

    if (ph === 'lobby') renderLobby();
    if (ph === 'question') {
      $('bigcode').textContent = S.q.code;
      optionEls($('optsQ'), false);
      renderHint();
      renderCount();
    }
    if (ph === 'reveal') renderReveal();
    if (ph === 'end') renderFinal();

    clearInterval(tick);
    if (ph === 'question') {
      const upd = () => {
        const left = Math.max(0, LIMIT - (Date.now() - S.qStart));
        $('secs').textContent = Math.ceil(left / 1000);
        $('secs').classList.toggle('hurry', left <= 5000);
        $('timefill').style.width = (left / LIMIT * 100) + '%';
        if (left <= 0) reveal();
      };
      upd();
      tick = setInterval(upd, 200);
    }
  }

  // ---------- arranque ----------
  $('start').addEventListener('click', ask);
  $('skip').addEventListener('click', reveal);
  $('next').addEventListener('click', next);
  $('again').addEventListener('click', again);
  addEventListener('keydown', (e) => { // espacio o flecha = siguiente (cómodo con el mando de diapositivas)
    if (e.key !== ' ' && e.key !== 'ArrowRight' && e.key !== 'PageDown') return;
    if (S.phase === 'reveal') { e.preventDefault(); next(); }
  });

  drawQR();
  render();
  connect(setNet).then((c) => {
    client = c;
    client.on('message', (topic, buf) => { if (topic === T.up(S.room)) onUp(parse(buf)); });
    client.on('connect', () => { announce(); publish(); });
    announce();
    publish();
  });
})();
