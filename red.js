/*
 * Red del modo clase: la sala (proyector) y los móviles se hablan a través de un
 * servidor MQTT público por WebSocket. La sala es la que manda: guarda la lista de
 * jugadores, hace las parejas y publica el estado; los móviles solo mandan avisos.
 *
 * Temas:
 *   BASE/actual             sala abierta ahora mismo (retenido)
 *   BASE/r/SALA/state       estado de la partida (retenido)
 *   BASE/r/SALA/up          avisos de los móviles a la sala
 *   BASE/r/SALA/p/ID        mensaje secreto para el jugador ID (retenido)
 */
(function (root) {
  'use strict';

  // El primero va por el puerto 443 (el de cualquier web https), que las redes de los
  // centros educativos casi nunca bloquean. Los otros usan puertos raros (8084, 8884) y
  // sirven de reserva en casa o en otras redes. La sala y los móviles tienen que acabar
  // en el MISMO servidor: la sala pone su número en el QR (?b=N) y el móvil lo prueba primero.
  const BROKERS = [
    { url: 'wss://public.cloud.shiftr.io', username: 'public', password: 'public' },
    { url: 'wss://broker.emqx.io:8084/mqtt' },
    { url: 'wss://broker.hivemq.com:8884/mqtt' }
  ];
  const BASE = 'mensaje-secreto-dsc/v1';

  const T = {
    actual: BASE + '/actual',
    state: (room) => `${BASE}/r/${room}/state`,
    up: (room) => `${BASE}/r/${room}/up`,
    inbox: (room, id) => `${BASE}/r/${room}/p/${id}`
  };

  /**
   * Conecta con el primer servidor que responda, empezando por el número `preferred`
   * (el que usa la sala). El cliente devuelto lleva `client.msBroker` = número del servidor.
   * onStatus('ok' | 'reconnecting' | 'offline' | 'slow').
   */
  function connect(onStatus, preferred) {
    return new Promise((resolve) => {
      let i = Number.isInteger(preferred) && preferred >= 0 && preferred < BROKERS.length ? preferred : 0;
      let done = false;
      // Si tarda, seguramente la red (p. ej. el wifi del instituto) bloquea los servidores.
      setTimeout(() => { if (!done && onStatus) onStatus('slow'); }, 8000);
      if (!root.mqtt) { if (onStatus) onStatus('slow'); return; } // la librería MQTT no ha cargado
      const tryNext = () => {
        const idx = i % BROKERS.length;
        i++;
        const b = BROKERS[idx];
        const opts = {
          clientId: 'ms_' + Math.random().toString(36).slice(2, 12),
          clean: true,
          keepalive: 30,
          reconnectPeriod: 2000,
          connectTimeout: 5000
        };
        if (b.username) { opts.username = b.username; opts.password = b.password; }
        const client = root.mqtt.connect(b.url, opts);
        client.msBroker = idx;
        const timer = setTimeout(() => {
          if (!done) { client.end(true); tryNext(); }
        }, 6000);
        client.on('connect', () => {
          clearTimeout(timer);
          if (onStatus) onStatus('ok');
          if (!done) { done = true; resolve(client); }
        });
        client.on('reconnect', () => { if (done && onStatus) onStatus('reconnecting'); });
        client.on('offline', () => { if (done && onStatus) onStatus('offline'); });
        client.on('error', () => {});
      };
      tryNext();
    });
  }

  function pub(client, topic, obj, retain) {
    const payload = obj === null ? '' : JSON.stringify(obj);
    client.publish(topic, payload, { qos: 1, retain: !!retain });
  }

  function parse(buf) {
    const s = buf.toString();
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  /** Normaliza para comparar respuestas: sin tildes, minúsculas, solo letras/números/espacios. */
  function norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Huella corta (FNV-1a) para comprobar la respuesta sin mandar el texto en claro. */
  function fingerprint(s) {
    let h = 0x811c9dc5;
    for (const ch of s) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36) + '.' + s.length;
  }

  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function roomCode() {
    let s = '';
    for (let k = 0; k < 4; k++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    return s;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };

  /** Lluvia de confeti en un canvas a pantalla completa. */
  function confetti(canvas, n) {
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = innerWidth * devicePixelRatio;
    const H = canvas.height = innerHeight * devicePixelRatio;
    const colors = ['#22d3ee', '#e879f9', '#fbbf24', '#34d399', '#ff3fb4'];
    const parts = Array.from({ length: n || 160 }, () => ({
      x: Math.random() * W, y: -Math.random() * H * 0.5,
      vx: (Math.random() - 0.5) * 4, vy: 3 + Math.random() * 5,
      s: (6 + Math.random() * 8) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)]
    }));
    let frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (++frames < 260) requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
    })();
  }

  root.Red = { connect, pub, parse, T, norm, fingerprint, roomCode, uid, store, confetti };
})(window);
