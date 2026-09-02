/* PeerJS networking - host + up to a few guests (star topology), same
   pattern as the poker game. No hidden information in this game, so the
   host just broadcasts the same state to everyone. */
(function (global) {
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

  function randomCode(len) {
    let out = '';
    for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return out;
  }

  const Net = {
    peer: null,
    isHost: false,
    roomCode: null,
    conns: new Map(),     // host only: peerId -> DataConnection
    hostConn: null,       // guest only: DataConnection to host
    myId: null,

    onData: null,
    onGuestConnected: null,
    onGuestLeft: null,
    onConnected: null,
    onClose: null,

    _wireHostSideConn(conn) {
      this.conns.set(conn.peer, conn);
      conn.on('data', (data) => { if (this.onData) this.onData(data, conn.peer); });
      conn.on('close', () => { this.conns.delete(conn.peer); if (this.onGuestLeft) this.onGuestLeft(conn.peer); });
      conn.on('error', () => { this.conns.delete(conn.peer); if (this.onGuestLeft) this.onGuestLeft(conn.peer); });
    },

    hostGame(onReady, onError, attempt) {
      attempt = attempt || 0;
      const code = randomCode(5);
      const peer = new Peer(code, { debug: 0 });
      this.peer = peer;
      this.isHost = true;

      peer.on('open', (id) => {
        this.roomCode = id;
        this.myId = id;
        onReady(id);
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          this._wireHostSideConn(conn);
          if (this.onGuestConnected) this.onGuestConnected(conn.peer);
        });
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && attempt < 5) {
          peer.destroy();
          this.hostGame(onReady, onError, attempt + 1);
        } else {
          onError(err);
        }
      });
    },

    joinGame(code, onConnected, onError) {
      const peer = new Peer(undefined, { debug: 0 });
      this.peer = peer;
      this.isHost = false;
      this.roomCode = code;

      peer.on('open', (id) => {
        this.myId = id;
        const conn = peer.connect(code.trim().toUpperCase(), { reliable: true });
        this.hostConn = conn;
        conn.on('open', () => { onConnected(); if (this.onConnected) this.onConnected(); });
        conn.on('data', (data) => { if (this.onData) this.onData(data, 'host'); });
        conn.on('close', () => { if (this.onClose) this.onClose(); });
        conn.on('error', (err) => onError(err));
      });

      peer.on('error', (err) => onError(err));
    },

    sendTo(peerId, obj) {
      const conn = this.conns.get(peerId);
      if (conn && conn.open) conn.send(obj);
    },
    broadcast(obj, exceptPeerId) {
      for (const [id, conn] of this.conns) {
        if (id === exceptPeerId) continue;
        if (conn.open) conn.send(obj);
      }
    },
    sendToHost(obj) {
      if (this.hostConn && this.hostConn.open) this.hostConn.send(obj);
    },
    teardown() {
      for (const conn of this.conns.values()) { try { conn.close(); } catch (e) {} }
      if (this.hostConn) { try { this.hostConn.close(); } catch (e) {} }
      if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
      this.conns = new Map();
      this.hostConn = null;
      this.peer = null;
    }
  };

  global.SNLNet = Net;
})(window);
