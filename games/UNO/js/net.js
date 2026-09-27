/* In-browser stand-in for the Socket.IO server, so UNO runs as a static site.

   Every browser runs the real room manager from core/ (bundled into
   engine.bundle.js). app.js talks to it through UnoNet.connect(), which
   returns an object with the same emit/on API as a socket.io client.

   - Solo games and rooms you create run in your own browser.
   - A room you create is also opened on PeerJS as "irgames-uno-<CODE>".
     Friends who join that code connect straight to your browser (star
     topology, like Poker); your browser is the authority and sends each
     player only their own view of the game.

   Wire format over the PeerJS data channel:
     guest -> host  { t: 'emit', ev, data, id }   (id set when an ack is wanted)
     host  -> guest { t: 'ack', id, res } | { t: 'ev', ev, data } */
(function (global) {
  'use strict';
  const { RoomManager } = global.UnoEngine.require('./rooms');
  const PEER_PREFIX = 'irgames-uno-';
  const CONNECT_TIMEOUT_MS = 9000;
  const RETRY_MS = 3000, MAX_RETRIES = 20;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  // messages cross a "network" even locally, so nobody shares mutable state
  const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const later = (fn) => setTimeout(fn, 0);
  let seq = 0;

  // ---------- the local "server" ----------
  class ServerSocket {
    constructor(id, send) {
      this.id = id;
      this.data = {};
      this.handlers = {};
      this.send = send;
    }
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
    emit(ev, data) { this.send(ev, copy(data)); }
    receive(ev, data, ack) { (this.handlers[ev] || []).forEach((fn) => fn(data, ack)); }
  }

  const sockets = new Map();
  const io = {
    sockets: { sockets },
    to: (id) => ({ emit: (ev, data) => { const s = sockets.get(id); if (s) s.emit(ev, data); } }),
  };
  const manager = new RoomManager(io);

  function attach(sock) { sockets.set(sock.id, sock); manager.handleConnection(sock); }
  function detach(sock) {
    if (!sockets.has(sock.id)) return;
    sock.receive('disconnect');
    sockets.delete(sock.id);
  }

  // ---------- hosting: publish your room on PeerJS ----------
  let hostPeer = null, hostedCode = null;

  function syncHosting() {
    const mine = localSock.data.roomCode;
    const code = mine && manager.rooms.has(mine) ? mine : null;
    if (code === hostedCode) return;
    // we left the room we were hosting: it can't outlive this browser, so close it for everyone
    const old = hostedCode && manager.rooms.get(hostedCode);
    if (old) {
      for (const s of sockets.values()) if (s !== localSock && s.data.roomCode === hostedCode) s.emit('room:kicked');
      manager.deleteRoom(old);
    }
    stopHosting();
    if (code) startHosting(code, 0);
  }

  function stopHosting() {
    if (hostPeer) hostPeer.destroy();
    hostPeer = null;
    hostedCode = null;
  }

  function startHosting(code, attempt) {
    if (typeof Peer === 'undefined') return; // offline: solo still works
    hostedCode = code;
    const peer = new Peer(PEER_PREFIX + code, { debug: 0 });
    hostPeer = peer;
    peer.on('connection', (conn) => {
      conn.on('open', () => serveGuest(conn));
    });
    peer.on('disconnected', () => { if (hostPeer === peer && !peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      if (hostPeer !== peer) return;
      if (err.type === 'unavailable-id' && attempt < 5) {
        // someone else on the broker already uses this code: rename our room
        peer.destroy();
        hostPeer = null;
        startHosting(renameRoom(code), attempt + 1);
      } else if (err.type !== 'peer-unavailable') {
        console.warn('[uno] hosting error:', err.type || err);
      }
    });
  }

  function renameRoom(oldCode) {
    const room = manager.rooms.get(oldCode);
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (manager.rooms.has(code));
    manager.rooms.delete(oldCode);
    room.code = code;
    manager.rooms.set(code, room);
    for (const s of sockets.values()) if (s.data.roomCode === oldCode) s.data.roomCode = code;
    manager.broadcast(room);
    return code;
  }

  function serveGuest(conn) {
    const sock = new ServerSocket('peer-' + conn.peer + '-' + ++seq, (ev, data) => {
      if (conn.open) conn.send({ t: 'ev', ev, data });
    });
    attach(sock);
    conn.on('data', (msg) => {
      if (!msg || msg.t !== 'emit' || typeof msg.ev !== 'string') return;
      const ack = msg.id == null ? undefined : (res) => { if (conn.open) conn.send({ t: 'ack', id: msg.id, res }); };
      sock.receive(msg.ev, msg.data || {}, ack);
    });
    const gone = () => detach(sock);
    conn.on('close', gone);
    conn.on('error', gone);
    conn.on('iceStateChanged', (s) => { if (s === 'disconnected' || s === 'failed' || s === 'closed') conn.close(); });
  }

  // ---------- the client socket app.js uses ----------
  const handlers = {};
  function fire(ev, data) { (handlers[ev] || []).forEach((fn) => fn(data)); }

  const localSock = new ServerSocket('local', (ev, data) => {
    if (!remote) later(() => fire(ev, data));
  });

  function emitLocal(ev, data, ack) {
    later(() => localSock.receive(ev, copy(data), (res) => {
      syncHosting();
      if (ack) later(() => ack(copy(res)));
    }));
  }

  // ---------- joining someone else's room ----------
  let guestPeer = null;
  let remote = null; // { code, conn, acks, retries, closedByUs }

  function getGuestPeer() {
    return new Promise((resolve, reject) => {
      if (guestPeer && guestPeer.open && !guestPeer.disconnected) return resolve(guestPeer);
      if (guestPeer) guestPeer.destroy();
      const peer = new Peer({ debug: 0 });
      guestPeer = peer;
      peer.on('open', () => resolve(peer));
      peer.on('error', (err) => { if (!peer.open) reject(err); });
    });
  }

  function openConn(code) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT_MS);
      getGuestPeer().then((peer) => {
        const onErr = (err) => { if (err.type === 'peer-unavailable') { clearTimeout(timer); reject(err); } };
        peer.on('error', onErr);
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => { clearTimeout(timer); peer.off('error', onErr); resolve(conn); });
      }, (err) => { clearTimeout(timer); reject(err); });
    });
  }

  function useConn(conn) {
    remote.conn = conn;
    conn.on('data', (msg) => {
      if (!remote || remote.conn !== conn || !msg) return;
      if (msg.t === 'ack') {
        const cb = remote.acks.get(msg.id);
        remote.acks.delete(msg.id);
        if (cb) cb(msg.res);
      } else if (msg.t === 'ev') {
        fire(msg.ev, msg.data);
        if (msg.ev === 'room:kicked') dropRemote();
      }
    });
    const lost = () => { if (remote && remote.conn === conn && !remote.closedByUs) onLost(); };
    conn.on('close', lost);
    conn.on('error', lost);
    conn.on('iceStateChanged', (s) => { if (s === 'disconnected' || s === 'failed') lost(); });
  }

  function sendRemote(ev, data, ack) {
    const msg = { t: 'emit', ev, data };
    if (ack) {
      msg.id = ++seq;
      remote.acks.set(msg.id, ack);
    }
    if (remote.conn && remote.conn.open) remote.conn.send(msg);
    else if (ack) { remote.acks.delete(msg.id); ack({ ok: false, error: 'Not connected to the host yet' }); }
  }

  function dropRemote() {
    if (!remote) return;
    remote.closedByUs = true;
    if (remote.conn) remote.conn.close();
    for (const cb of remote.acks.values()) cb({ ok: false, error: 'Disconnected' });
    remote = null;
  }

  // host went away: tell the app, then keep trying to get back in
  function onLost() {
    const r = remote;
    r.conn = null;
    fire('disconnect');
    const retry = () => {
      if (remote !== r) return;
      if (++r.retries > MAX_RETRIES) {
        dropRemote();
        return fire('room:kicked'); // back to the home screen
      }
      openConn(r.code).then((conn) => {
        if (remote !== r) return conn.close();
        r.retries = 0;
        useConn(conn);
        fire('connect'); // app.js re-sends room:join with its saved token
      }, () => setTimeout(retry, RETRY_MS));
    };
    setTimeout(retry, RETRY_MS);
  }

  async function joinRemote(data, ack) {
    const code = String(data.code || '').trim().toUpperCase();
    if (remote && remote.code === code && remote.conn && remote.conn.open) return sendRemote('room:join', data, ack);
    dropRemote();
    if (localSock.data.roomCode) emitLocal('room:leave', {});
    const r = { code, conn: null, acks: new Map(), retries: 0, closedByUs: false };
    remote = r;
    try {
      const conn = await openConn(code);
      if (remote !== r) return conn.close();
      useConn(conn);
      sendRemote('room:join', { ...data, code }, (res) => {
        if (!res || !res.ok) dropRemote();
        if (ack) ack(res);
      });
    } catch (e) {
      if (remote === r) remote = null;
      if (ack) ack({ ok: false, error: 'Room not found — check the code' });
    }
  }

  const client = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit(ev, data, ack) {
      data = data || {};
      if (ev === 'room:join') {
        const code = String(data.code || '').trim().toUpperCase();
        if (manager.rooms.has(code)) { dropRemote(); return emitLocal(ev, data, ack); }
        return joinRemote(data, ack);
      }
      if (ev === 'room:create') { dropRemote(); return emitLocal(ev, data, ack); }
      if (remote) {
        if (ev === 'room:leave') return sendRemote(ev, data, (res) => { dropRemote(); if (ack) ack(res); });
        return sendRemote(ev, data, ack);
      }
      emitLocal(ev, data, ack);
    },
  };

  global.UnoNet = {
    connect() {
      attach(localSock);
      later(() => fire('connect'));
      return client;
    },
  };

  // tell guests we're gone when the host closes the tab
  global.addEventListener('pagehide', () => { stopHosting(); if (guestPeer) guestPeer.destroy(); });
})(window);
