/* Sala (proyector): recoge los nombres, hace parejas al azar y sigue la partida. */
(function () {
  'use strict';
  const { connect, pub, parse, T, roomCode, store, confetti } = window.Red;
  const $ = (id) => document.getElementById(id);
  const KEY = 'ms_sala';

  let client = null;
  let tick = null;
  let rendered = { chips: new Set(), pairsKey: '' };

  const fresh = () => ({
    room: roomCode(), phase: 'lobby', players: [], groups: [],
    startedAt: 0, endedAt: 0, sent: {}, solved: []
  });
  let S = store.get(KEY) || fresh();

  const nameOf = (id) => (S.players.find((p) => p.id === id) || {}).name || '¿?';
  const save = () => store.set(KEY, S);
  const publish = () => { if (client) pub(client, T.state(S.room), S, true); };
  const commit = () => { save(); publish(); render(); };

  function joinUrl() {
    const u = new URL('jugar.html', location.href);
    u.search = '?sala=' + S.room;
    return u.toString();
  }

  // ---------- red ----------
  function setNet(st) {
    const map = {
      ok: ['', 'Conectado'],
      reconnecting: ['warn', 'Reconectando…'],
      offline: ['off', 'Sin conexión']
    };
    const [cls, txt] = map[st] || map.offline;
    $('net').innerHTML = '';
    const d = document.createElement('span');
    d.className = 'dot ' + cls;
    $('net').append(d, txt);
  }

  function onUp(m) {
    if (!m || !m.id) return;
    if (m.t === 'join') {
      const name = String(m.name || '').trim().slice(0, 18);
      if (!name) return;
      const me = S.players.find((p) => p.id === m.id);
      if (me) { me.name = name; commit(); return; }
      if (S.phase !== 'lobby') return; // la partida ya ha empezado
      let final = name;
      let k = 2;
      while (S.players.some((p) => p.name.toLowerCase() === final.toLowerCase())) final = `${name} ${k++}`;
      S.players.push({ id: m.id, name: final });
      commit();
    } else if (m.t === 'leave' && S.phase === 'lobby') {
      S.players = S.players.filter((p) => p.id !== m.id);
      commit();
    } else if (m.t === 'sent' && S.phase === 'game') {
      if (!S.sent[m.id]) { S.sent[m.id] = true; commit(); }
    } else if (m.t === 'solved' && S.phase === 'game') {
      if (!S.solved.some((x) => x.id === m.id)) {
        S.solved.push({ id: m.id, ms: Date.now() - S.startedAt });
        commit();
        if (S.solved.length === 1) confetti($('burst'), 90);
      }
    }
  }

  // ---------- acciones ----------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function start() {
    if (S.players.length < 2) return;
    const ids = shuffle(S.players.map((p) => p.id));
    const groups = [];
    for (let i = 0; i + 1 < ids.length; i += 2) groups.push([ids[i], ids[i + 1]]);
    if (ids.length % 2) groups[groups.length - 1].push(ids[ids.length - 1]); // impar: un trío
    S.groups = groups;
    S.phase = 'game';
    S.startedAt = Date.now();
    S.sent = {};
    S.solved = [];
    commit();
  }

  function finish() {
    S.phase = 'end';
    S.endedAt = Date.now();
    commit();
    confetti($('burst'), 220);
  }

  function again() {
    if (client) {
      pub(client, T.state(S.room), null, true); // borra el estado retenido de la sala vieja
      for (const p of S.players) pub(client, T.inbox(S.room, p.id), null, true);
    }
    S = fresh();
    rendered = { chips: new Set(), pairsKey: '' };
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
    const url = joinUrl();
    if (window.QRCode) {
      new window.QRCode(box, {
        text: url, width: 512, height: 512,
        colorDark: '#07091a', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } else {
      box.textContent = url;
    }
    $('code').textContent = S.room;
  }

  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

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
    $('start').disabled = S.players.length < 2;
  }

  function personEl(id) {
    const w = document.createElement('div');
    const solvedAt = S.solved.findIndex((x) => x.id === id);
    w.className = 'who' + (solvedAt >= 0 ? ' solved' : S.sent[id] ? ' sent' : '');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = nameOf(id);
    const s = document.createElement('span');
    s.className = 's';
    s.textContent = solvedAt >= 0 ? `🔓 descifrado · #${solvedAt + 1}` : S.sent[id] ? '✉ enviado' : '✎ escribiendo…';
    w.append(n, s);
    return w;
  }

  function renderGame() {
    const pairs = $('pairs');
    pairs.innerHTML = '';
    const firstTime = rendered.pairsKey !== S.room + S.startedAt;
    S.groups.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'pair';
      if (firstTime) card.style.setProperty('--i', i);
      else card.style.animation = 'none';
      g.forEach((id, k) => {
        if (k) {
          const a = document.createElement('span');
          a.className = 'arrow';
          a.textContent = g.length === 2 ? '⇄' : '→';
          card.append(a);
        }
        card.append(personEl(id));
      });
      pairs.append(card);
    });
    rendered.pairsKey = S.room + S.startedAt;

    $('sSent').textContent = Object.keys(S.sent).length;
    $('sSolved').textContent = S.solved.length;
    $('sTotal').textContent = S.players.length;

    const pod = $('podium');
    const before = pod.children.length;
    pod.innerHTML = '';
    S.solved.slice(0, 5).forEach((x, i) => {
      const li = rankItem(i, x.id, x.ms);
      if (i < before) li.style.animation = 'none'; // solo entra con animación el nuevo
      pod.append(li);
    });
    $('podiumEmpty').hidden = S.solved.length > 0;
  }

  function rankItem(i, id, ms) {
    const li = document.createElement('li');
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = ms == null ? '·' : (['🥇', '🥈', '🥉'][i] || String(i + 1));
    const n = document.createElement('span');
    n.textContent = nameOf(id);
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = ms == null ? '—' : fmt(ms);
    li.append(pos, n, t);
    if (ms == null) li.className = 'none';
    return li;
  }

  function renderFinal() {
    const ol = $('finalRank');
    ol.innerHTML = '';
    S.solved.forEach((x, i) => ol.append(rankItem(i, x.id, x.ms)));
    S.players.filter((p) => !S.solved.some((x) => x.id === p.id))
      .forEach((p) => ol.append(rankItem(99, p.id, null)));
  }

  function render() {
    const ph = S.phase;
    $('lobby').hidden = ph !== 'lobby';
    $('game').hidden = ph !== 'game';
    $('final').hidden = ph !== 'end';
    $('start').hidden = ph !== 'lobby';
    $('finish').hidden = ph !== 'game';
    $('again').hidden = ph === 'lobby';
    $('clock').hidden = ph === 'lobby';
    $('title').innerHTML = ph === 'lobby'
      ? '<span class="grad">¡A jugar!</span>'
      : ph === 'game' ? 'Mandad un mensaje secreto a vuestra pareja… <span class="grad">¡y descifrad el suyo!</span>'
        : '<span class="grad">Ranking final</span>';
    if (ph === 'lobby') renderLobby();
    if (ph === 'game') renderGame();
    if (ph === 'end') renderFinal();

    clearInterval(tick);
    if (ph === 'game') {
      const upd = () => { $('clock').textContent = fmt(Date.now() - S.startedAt); };
      upd();
      tick = setInterval(upd, 500);
    } else if (ph === 'end') {
      $('clock').textContent = fmt(S.endedAt - S.startedAt);
    }
  }

  // ---------- arranque ----------
  $('start').addEventListener('click', start);
  $('finish').addEventListener('click', finish);
  $('again').addEventListener('click', again);

  drawQR();
  render();
  connect(setNet).then((c) => {
    client = c;
    client.on('message', (topic, buf) => {
      if (topic === T.up(S.room)) onUp(parse(buf));
    });
    client.on('connect', () => { announce(); publish(); }); // al reconectar
    announce();
    publish();
  });
})();
