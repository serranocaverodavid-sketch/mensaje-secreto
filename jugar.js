/* Móvil, modo concurso: entra con tu nombre y elige la palabra correcta lo antes posible. */
(function () {
  'use strict';
  const { connect, pub, parse, T, uid, store, confetti } = window.Red;
  const $ = (id) => document.getElementById(id);
  const COLORS = ['c0', 'c1', 'c2', 'c3'];
  const SHAPES = ['▲', '◆', '●', '■'];

  let client = null;
  let room = new URLSearchParams(location.search).get('sala');
  room = room ? room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : null;
  let S = null; // estado que publica la sala
  let me = null; // { id, name, joined, picks: { ronda: opción } }
  let askShownAt = 0;
  let timer = null;
  let celebrated = -1;

  const meKey = () => 'ms_me_quiz_' + room;
  const saveMe = () => store.set(meKey(), me);

  const VIEWS = ['vLoading', 'vJoin', 'vWait', 'vAsk', 'vResult', 'vInfo'];
  function show(v) { for (const x of VIEWS) $(x).hidden = x !== v; }

  function setNet(st) {
    const map = {
      ok: ['', 'Conectado'], reconnecting: ['warn', 'Reconectando…'], offline: ['off', 'Sin conexión'],
      slow: ['off', 'No conecta']
    };
    const [cls, txt] = map[st] || map.offline;
    if (st === 'slow') $('loadingMsg').textContent = 'No conecta con el juego. Quita el wifi y usa los datos móviles 📶';
    const d = document.createElement('span');
    d.className = 'dot ' + cls;
    $('net').replaceChildren(d, txt);
  }

  const listed = () => S && S.players.some((p) => p.id === me.id);
  const myName = () => ((S && S.players.find((p) => p.id === me.id)) || {}).name || me.name;
  function myPlace() {
    const sorted = [...S.players].sort((a, b) => (S.scores[b.id] || 0) - (S.scores[a.id] || 0));
    return sorted.findIndex((p) => p.id === me.id) + 1;
  }

  function wait(top, text) {
    $('waitTop').textContent = top;
    $('waitName').textContent = myName();
    $('waitText').textContent = text;
    $('waitCount').textContent = S && S.players.length > 1 ? `Sois ${S.players.length} jugando.` : '';
    show('vWait');
  }

  // ---------- pintar ----------
  function render() {
    clearInterval(timer);
    if (!room || !S) return;
    $('eyebrow').textContent = S.phase === 'lobby' || !S.round ? 'El juego del mensaje secreto' : `Ronda ${S.round} de ${S.rounds}`;

    if (!me.joined) { show('vJoin'); return; }
    if (!listed()) {
      if (me.wasListed) { // la sala te ha quitado
        me.joined = false; me.wasListed = false; saveMe();
        $('joinMsg').textContent = 'Te han quitado de la sala. Puedes volver a entrar.';
        show('vJoin');
      } else {
        wait('Entrando…', 'Un segundo…');
      }
      return;
    }
    me.wasListed = true;
    saveMe();

    if (S.phase === 'lobby') { wait('¡Estás dentro!', 'Mira la pantalla: la partida empieza enseguida.'); return; }

    if (S.phase === 'question') {
      if (me.picks[S.round] != null) {
        wait('¡Respuesta enviada!', '¿Habrás acertado? Mira la pantalla…');
        return;
      }
      renderAsk();
      return;
    }

    if (S.phase === 'reveal') { renderResult(); return; }

    if (S.phase === 'end') {
      const place = myPlace();
      $('resIcon').textContent = ['🥇', '🥈', '🥉'][place - 1] || '🏁';
      $('resTitle').textContent = place <= 3 ? '¡Estás en el podio!' : '¡Fin de la partida!';
      $('resText').textContent = `${S.scores[me.id] || 0} puntos`;
      $('resPlace').textContent = `Puesto #${place} de ${S.players.length}`;
      show('vResult');
      if (place === 1 && celebrated !== 99) { celebrated = 99; confetti($('burst'), 200); }
    }
  }

  function renderAsk() {
    const q = S.q;
    $('askCode').textContent = q.code;
    const box = $('abtns');
    box.innerHTML = '';
    q.options.forEach((w, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'abtn ' + COLORS[i];
      const s = document.createElement('span');
      s.className = 'shape';
      s.textContent = SHAPES[i];
      const t = document.createElement('span');
      t.textContent = w;
      b.append(s, t);
      b.addEventListener('click', () => answer(i));
      box.append(b);
    });
    show('vAsk');
    const limit = S.limit || 20000;
    const start = askShownAt;
    const upd = () => {
      const left = Math.max(0, limit - (Date.now() - start));
      $('timefill').style.width = (left / limit * 100) + '%';
    };
    upd();
    timer = setInterval(upd, 200);
  }

  function renderResult() {
    const pick = me.picks[S.round];
    const gain = (S.gains || {})[me.id] || 0;
    const right = S.q.options[S.q.correct];
    if (pick == null) {
      $('resIcon').textContent = '⏰';
      $('resTitle').textContent = '¡Se acabó el tiempo!';
      $('resText').textContent = `Era «${right}».`;
    } else if (gain) {
      $('resIcon').textContent = '✅';
      $('resTitle').textContent = `¡Correcto! +${gain}`;
      $('resText').textContent = `Era «${right}».`;
      if (celebrated !== S.round) {
        celebrated = S.round;
        confetti($('burst'), 90);
        if (navigator.vibrate) navigator.vibrate([50, 30, 90]);
      }
    } else {
      $('resIcon').textContent = '❌';
      $('resTitle').textContent = '¡Casi!';
      $('resText').textContent = `Era «${right}».`;
    }
    $('resPlace').textContent = `Vas el #${myPlace()} · ${S.scores[me.id] || 0} pts`;
    show('vResult');
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

  function answer(i) {
    if (!S || S.phase !== 'question' || me.picks[S.round] != null) return;
    me.picks[S.round] = i;
    saveMe();
    pub(client, T.up(room), { t: 'answer', id: me.id, round: S.round, choice: i });
    if (navigator.vibrate) navigator.vibrate(30);
    render();
  }

  // ---------- red ----------
  function onState(st) {
    if (!st) return;
    const newQuestion = st.phase === 'question' && (!S || S.phase !== 'question' || S.round !== st.round);
    S = st;
    if (newQuestion) askShownAt = Date.now();
    render();
  }

  function subscribeRoom() {
    me = store.get(meKey()) || { id: uid(), name: '', joined: false, picks: {} };
    me.picks = me.picks || {};
    saveMe();
    client.subscribe(T.state(room), { qos: 1 });
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
      }
    });
    client.on('connect', () => { // al reconectar: volver a avisar de que sigo aquí
      if (room && me && me.joined) pub(client, T.up(room), { t: 'join', id: me.id, name: me.name });
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
  show('vLoading');
  connect(setNet).then(boot);
})();
