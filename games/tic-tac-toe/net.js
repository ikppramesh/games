/* Thin wrapper around PeerJS for the host <-> guest data connection.
   Uses PeerJS's free public broker just to exchange WebRTC signaling;
   once connected, gameplay data flows directly peer-to-peer. */
(function (global) {
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, less confusing to type

  function randomCode(len) {
    let out = '';
    for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return out;
  }

  const Net = {
    peer: null,
    conn: null,
    isHost: false,
    roomCode: null,

    onData: null,        // (data) => void
    onGuestConnected: null, // () => void  (host side)
    onClose: null,        // () => void

    _wireConn(conn) {
      this.conn = conn;
      conn.on('data', (data) => { if (this.onData) this.onData(data); });
      conn.on('close', () => { if (this.onClose) this.onClose(); });
      conn.on('error', () => { if (this.onClose) this.onClose(); });
    },

    hostGame(onReady, onError, attempt) {
      attempt = attempt || 0;
      const code = randomCode(5);
      const peer = new Peer(code, { debug: 0 });
      this.peer = peer;
      this.isHost = true;

      peer.on('open', (id) => {
        this.roomCode = id;
        onReady(id);
      });

      peer.on('connection', (conn) => {
        // a single guest is supported per game
        this._wireConn(conn);
        conn.on('open', () => { if (this.onGuestConnected) this.onGuestConnected(); });
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

      peer.on('open', () => {
        const conn = peer.connect(code.trim().toUpperCase(), { reliable: true });
        this._wireConn(conn);
        conn.on('open', () => onConnected());
        conn.on('error', (err) => onError(err));
      });

      peer.on('error', (err) => onError(err));
    },

    send(obj) {
      if (this.conn && this.conn.open) this.conn.send(obj);
    },

    teardown() {
      if (this.conn) { try { this.conn.close(); } catch (e) {} }
      if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
      this.conn = null;
      this.peer = null;
    }
  };

  global.Net = Net;
})(window);
