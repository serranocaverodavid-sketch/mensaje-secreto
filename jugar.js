/* Móvil: entra con tu nombre, manda un mensaje cifrado a tu pareja y descifra el suyo. */
(function () {
  'use strict';
  const { connect, pub, parse, T, norm, fingerprint, uid, store, confetti } = window.Red;
  const { encode, TABLES } = window.Cipher;
  const TBL = TABLES.original;
  const $ = (id) => document.getElementById(id);

  let client = null;
  let room = new URLSearchParams(location.search).get('sala');
  room = room ? room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : null;
  let S = null; // estado publicado por la sala
  let me = null; // { id, name, joined, sent, solved, wasListed }
  let inbox = null; // { from, fromName, code, fp }

  const meKey = () => 'ms_me_' + room;
  const saveMe = () => store.set(meKey(), me);

  // ---------- vistas ----------
  const VIEWS = ['vLoading', 'vJoin', 'vWait', 'vGame', 'vInfo'];
  function show(v) { for (const x of VIEWS) $(x).hidden = x !== v; }

  function info(icon, title, text) {
    $('infoIcon').textContent = icon;
    $('infoTitle').textContent = title;
    $('infoText').textContent = text;
    show('vInfo');
  }

  function setNet(st) {
    const map = { ok: ['', 'Conectado'], reconnecting: ['warn', 'Reconectando…'], offline: ['off', 'Sin conexión'] };
    const [cls, txt] = map[st] || map.offline;
    const d = document.createElement('span');
    d.className = 'dot ' + cls;
    $('net').replaceChildren(d, txt);
  }

  const nameOf = (id) => ((S && S.players.find((p) => p.id === id)) || {}).name || '¿?';

  function myGroup() {
    if (!S || !S.groups) return null;
    return S.groups.find((g) => g.includes(me.id)) || null;
  }

  // ---------- pintar según el estado ----------
  function render() {
    if (!room || !S) return;
    const listed = S.players.some((p) => p.id === me.id);

    if (S.phase === 'lobby') {
      if (me.wasListed && !listed) { // la sala te ha quitado
        me.joined = false; me.wasListed = false; saveMe();
        $('joinMsg').textContent = 'Te han quitado de la sala. Puedes volver a entrar.';
      }
      if (listed) {
        me.wasListed = true; saveMe();
        $('waitName').textContent = nameOf(me.id);
        $('waitCount').textContent = S.players.length === 1 ? 'De momento solo estás tú.' : `Ya sois ${S.players.length} en la sala.`;
        show('vWait');
      } else if (me.joined) {
        show('vWait');
        $('waitName').textContent = me.name;
        $('waitCount').textContent = 'Entrando…';
      } else {
        show('vJoin');
      }
      return;
    }

    if (S.phase === 'game') {
      const g = myGroup();
      if (!g) {
        info('⏳', 'La partida ya ha empezado', 'Mira la pantalla y espera a la siguiente ronda.');
        return;
      }
      renderGame(g);
      show('vGame');
      return;
    }

    if (S.phase === 'end') {
      const pos = S.solved.findIndex((x) => x.id === me.id);
      if (pos >= 0) info(['🥇', '🥈', '🥉'][pos] || '🎉', `¡Fin! Quedaste en el puesto ${pos + 1}`, 'Mira la pantalla para ver el ranking completo.');
      else info('🏁', '¡Fin de la partida!', 'Mira la pantalla para ver el ranking.');
    }
  }

  function renderGame(g) {
    const i = g.indexOf(me.id);
    const to = g[(i + 1) % g.length];
    const from = g[(i - 1 + g.length) % g.length];
    if (g.length === 2) {
      $('mateLabel').textContent = 'Tu pareja es';
      $('mate').textContent = nameOf(to);
      $('mateNote').textContent = 'Buscad dónde está el otro… ¡pero no os digáis el mensaje!';
    } else {
      $('mateLabel').textContent = 'Sois un trío';
      $('mate').textContent = g.filter((x) => x !== me.id).map(nameOf).join(' y ');
      $('mateNote').textContent = `Tú escribes a ${nameOf(to)} y descifras el de ${nameOf(from)}.`;
    }
    me.to = to;

    // ① enviar
    $('sendForm').hidden = !!me.sent;
    $('sentOk').hidden = !me.sent;
    if (me.sent) $('sentOk').textContent = `✓ Enviado a ${nameOf(to)}: ${me.sentCode}`;

    // ② recibir
    const solvedPos = S.solved.findIndex((x) => x.id === me.id);
    if (me.solved || solvedPos >= 0) {
      $('recvWait').hidden = true;
      $('recvBox').hidden = true;
      $('winBox').hidden = false;
      $('medal').textContent = ['🥇', '🥈', '🥉'][solvedPos] || '🎉';
      $('place').textContent = solvedPos >= 0 ? `Puesto #${solvedPos + 1}` : '¡Bien!';
      $('plain').textContent = me.solvedText || '';
    } else if (inbox && inbox.from === from) {
      $('recvWait').hidden = true;
      $('winBox').hidden = true;
      if ($('recvBox').hidden) {
        $('recvBox').hidden = false;
        $('recvFrom').textContent = `Mensaje de ${inbox.fromName || nameOf(from)}:`;
        $('secret').textContent = inbox.code;
      }
    } else {
      $('recvBox').hidden = true;
      $('winBox').hidden = true;
      $('recvWait').hidden = false;
      $('recvWaitTxt').textContent = `Esperando a que ${nameOf(from)} te escriba…`;
    }
  }

  // ---------- acciones ----------
  function join(e) {
    e.preventDefault();
    const name = $('name').value.replace(/\s+/g, ' ').trim().slice(0, 18);
    if (!name) { $('joinMsg').textContent = 'Escribe tu nombre.'; return; }
    if (!client) { $('joinMsg').textContent = 'Aún conectando… prueba en un segundo.'; return; }
    me.name = name;
    me.joined = true;
    saveMe();
    $('joinMsg').textContent = '';
    pub(client, T.up(room), { t: 'join', id: me.id, name });
    render();
  }

  // Solo letras y signos que existen en la tabla (y espacios).
  function clean(text) {
    return [...text.normalize('NFC')].filter((ch) => ch === ' ' || TBL.enc.has(ch)).join('').replace(/\s+/g, ' ');
  }

  function updatePreview() {
    const t = clean($('text').value);
    $('preview').textContent = t.trim() ? encode(t.trim(), TBL).out : '';
  }

  function send() {
    const t = clean($('text').value).trim();
    if (!/[A-Za-zÑñÁÉÍÓÚÜáéíóúü]/.test(t)) { $('sendMsg').textContent = 'Escribe algo con letras.'; return; }
    const code = encode(t, TBL).out;
    pub(client, T.inbox(room, me.to), { from: me.id, fromName: me.name || nameOf(me.id), code, fp: fingerprint(norm(t)) }, true);
    pub(client, T.up(room), { t: 'sent', id: me.id });
    me.sent = true;
    me.sentCode = code;
    saveMe();
    $('sendMsg').textContent = '';
    render();
  }

  function guess(e) {
    e.preventDefault();
    if (!inbox) return;
    const g = $('guess').value;
    if (fingerprint(norm(g)) === inbox.fp) {
      me.solved = true;
      me.solvedText = g.trim();
      saveMe();
      pub(client, T.up(room), { t: 'solved', id: me.id });
      confetti($('burst'), 140);
      if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
      render();
    } else {
      const box = $('guessForm');
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      $('guessMsg').className = 'msg bad';
      $('guessMsg').textContent = 'Casi… revisa la tabla y vuelve a probar.';
    }
  }

  function buildTable() {
    const grid = $('tbl');
    if (grid.childElementCount) return;
    const letters = 'abcdefghijklmnñopqrstuvwxyzABCDEFGHIJKLMNÑOPQRSTUVWXYZáéíóú';
    for (const ch of letters) {
      const code = TBL.enc.get(ch);
      if (!code) continue;
      const d = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = ch;
      const s = document.createElement('span');
      s.textContent = code;
      d.append(b, s);
      grid.append(d);
    }
    const sp = document.createElement('div');
    sp.innerHTML = '<b>espacio</b><span>--</span>';
    sp.style.gridColumn = 'span 2';
    grid.append(sp);
  }

  // ---------- red ----------
  function onState(st) {
    if (!st) return;
    S = st;
    render();
  }

  function subscribeRoom() {
    me = store.get(meKey()) || { id: uid(), name: '', joined: false };
    saveMe();
    client.subscribe([T.state(room), T.inbox(room, me.id)], { qos: 1 });
    show('vLoading');
    $('loadingMsg').textContent = 'Entrando en la sala ' + room + '…';
    setTimeout(() => {
      if (!S) $('loadingMsg').textContent = 'No encuentro la sala ' + room + '. ¿Está abierta en la pantalla de clase?';
    }, 8000);
  }

  function boot(c) {
    client = c;
    client.on('message', (topic, buf) => {
      const m = parse(buf);
      if (topic === T.actual) {
        if (!room && m && m.room) {
          room = m.room;
          client.unsubscribe(T.actual);
          subscribeRoom();
        }
      } else if (room && topic === T.state(room)) {
        onState(m);
      } else if (room && me && topic === T.inbox(room, me.id)) {
        inbox = m;
        render();
      }
    });
    client.on('connect', () => { // al reconectar: volver a avisar de que sigo aquí
      if (room && me && me.joined && S && S.phase === 'lobby') pub(client, T.up(room), { t: 'join', id: me.id, name: me.name });
    });

    if (room) {
      subscribeRoom();
    } else {
      client.subscribe(T.actual, { qos: 1 });
      setTimeout(() => {
        if (!room) $('loadingMsg').textContent = 'No hay ninguna sala abierta ahora mismo. Espera a que la abran en la pantalla de clase.';
      }, 8000);
    }
  }

  $('vJoin').addEventListener('submit', join);
  $('text').addEventListener('input', updatePreview);
  $('send').addEventListener('click', send);
  $('guessForm').addEventListener('submit', guess);
  $('tblBtn').addEventListener('click', () => {
    buildTable();
    $('tbl').hidden = !$('tbl').hidden;
    $('tblBtn').textContent = $('tbl').hidden ? '📜 Ver tabla' : '📜 Ocultar tabla';
  });

  show('vLoading');
  connect(setNet).then(boot);
})();
