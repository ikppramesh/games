'use strict';
const crypto = require('crypto');
const { Game } = require('./engine/game');
const { botAction } = require('./engine/bot');
const C = require('./engine/cards');
const variants = require('./variants');

const MAX_PLAYERS = 10;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['Arjun', 'Maya', 'Leo', 'Priya', 'Kai', 'Zara', 'Ravi', 'Nina', 'Omar', 'Sita', 'Theo', 'Anya'];
const DISCONNECTED_GRACE_MS = 15000; // a disconnected player's turn is auto-played after this
const IDLE_ROOM_MS = 30 * 60 * 1000;

const uid = () => crypto.randomBytes(8).toString('hex');
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Player';
const cleanToken = (t) => (typeof t === 'string' && /^[\w-]{8,64}$/.test(t) ? t : null);

class UserError extends Error {}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    const sweeper = setInterval(() => this.sweep(), 5 * 60 * 1000);
    if (sweeper.unref) sweeper.unref(); // Node: don't keep the process alive
  }

  handleConnection(socket) {
    socket.emit('meta', { variants: variants.list(), maxPlayers: MAX_PLAYERS });
    const on = (event, fn) => socket.on(event, (data, ack) => {
      let res;
      try {
        res = fn.call(this, socket, data || {}) || { ok: true };
      } catch (e) {
        if (!(e instanceof UserError)) console.error(e);
        res = { ok: false, error: e instanceof UserError ? e.message : 'Something went wrong' };
      }
      if (typeof ack === 'function') ack(res);
    });
    on('room:create', this.create);
    on('room:join', this.join);
    on('room:leave', this.leave);
    on('room:settings', this.updateSettings);
    on('room:addBot', this.addBot);
    on('room:remove', this.removeMember);
    on('room:start', this.start);
    on('room:lobby', this.backToLobby);
    on('game:action', this.action);
    socket.on('disconnect', () => this.onDisconnect(socket));
  }

  // ---------- room lifecycle ----------

  newCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  create(socket, { name, token, settings }) {
    token = cleanToken(token);
    if (!token) throw new UserError('Missing player token');
    this.leave(socket);
    const variant = variants.get('classic');
    const room = {
      code: this.newCode(),
      hostId: null,
      members: [],
      settings: { variant: variant.id, theme: 'classic', rules: { ...variant.rules }, customCards: [] },
      game: null,
      timers: {},
      catchKey: null,
      lastActive: Date.now(),
    };
    if (settings) this.applySettings(room, settings);
    this.rooms.set(room.code, room);
    const m = this.addHuman(room, socket, name, token);
    room.hostId = m.id;
    this.broadcast(room);
    return { ok: true, code: room.code };
  }

  join(socket, { code, name, token }) {
    token = cleanToken(token);
    if (!token) throw new UserError('Missing player token');
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) throw new UserError('Room not found — check the code');
    const existing = room.members.find((m) => !m.isBot && m.token === token);
    if (existing) {
      if (socket.data.roomCode && socket.data.roomCode !== room.code) this.leave(socket);
      if (existing.socketId && existing.socketId !== socket.id) {
        const old = this.io.sockets.sockets.get(existing.socketId);
        if (old) old.data = {};
      }
      existing.socketId = socket.id;
      existing.connected = true;
      socket.data = { roomCode: room.code, memberId: existing.id };
    } else {
      if (room.game && room.game.phase !== 'over') throw new UserError('That game has already started');
      if (room.members.length >= MAX_PLAYERS) throw new UserError('That room is full');
      this.leave(socket);
      this.addHuman(room, socket, name, token);
    }
    this.broadcast(room);
    return { ok: true, code: room.code };
  }

  addHuman(room, socket, name, token) {
    let base = cleanName(name);
    let n = base;
    for (let i = 2; room.members.some((m) => m.name === n); i++) n = `${base} ${i}`;
    const m = { id: uid(), name: n, isBot: false, token, socketId: socket.id, connected: true };
    room.members.push(m);
    socket.data = { roomCode: room.code, memberId: m.id };
    return m;
  }

  leave(socket) {
    const { room, member } = this.ctx(socket, false);
    socket.data = {};
    if (!room || !member) return { ok: true };
    const inGame = room.game && room.game.phase !== 'over' && room.game.byId(member.id);
    if (inGame) {
      // Keep their seat but let the computer take over.
      member.isBot = true;
      member.token = null;
      member.socketId = null;
      member.name = `${member.name} (bot)`;
      const gp = room.game.byId(member.id);
      gp.isBot = true;
      gp.name = member.name;
    } else {
      room.members = room.members.filter((m) => m !== member);
      if (room.game) room.game = null;
    }
    this.fixHost(room);
    if (!room.members.some((m) => !m.isBot)) return this.deleteRoom(room);
    this.broadcast(room);
    return { ok: true };
  }

  fixHost(room) {
    const host = room.members.find((m) => m.id === room.hostId);
    if (host && !host.isBot) return;
    const next = room.members.find((m) => !m.isBot && m.connected) || room.members.find((m) => !m.isBot);
    if (next) room.hostId = next.id;
  }

  deleteRoom(room) {
    clearTimeout(room.timers.bot);
    clearTimeout(room.timers.catch);
    this.rooms.delete(room.code);
    return { ok: true };
  }

  onDisconnect(socket) {
    const { room, member } = this.ctx(socket, false);
    if (!room || !member || member.socketId !== socket.id) return;
    member.connected = false;
    member.socketId = null;
    if (room.hostId === member.id) {
      const other = room.members.find((m) => !m.isBot && m.connected);
      if (other) room.hostId = other.id;
    }
    this.broadcast(room);
  }

  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const anyone = room.members.some((m) => !m.isBot && m.connected);
      if (!anyone && now - room.lastActive > IDLE_ROOM_MS) this.deleteRoom(room);
    }
  }

  // ---------- host controls ----------

  ctx(socket, required = true) {
    const { roomCode, memberId } = socket.data || {};
    const room = roomCode && this.rooms.get(roomCode);
    const member = room && room.members.find((m) => m.id === memberId);
    if (required && (!room || !member)) throw new UserError('You are not in a room');
    return { room, member };
  }

  hostCtx(socket) {
    const c = this.ctx(socket);
    if (c.room.hostId !== c.member.id) throw new UserError('Only the host can do that');
    return c;
  }

  assertLobby(room) {
    if (room.game && room.game.phase !== 'over') throw new UserError('A game is in progress');
  }

  applySettings(room, s) {
    let variant = variants.get(room.settings.variant);
    if (typeof s.variant === 'string' && s.variant !== variant.id) {
      variant = variants.get(s.variant);
      room.settings.variant = variant.id;
      room.settings.rules = { ...variant.rules };
    }
    if (typeof s.theme === 'string' && /^[a-z0-9-]{1,30}$/.test(s.theme)) room.settings.theme = s.theme;
    if (s.rules) room.settings.rules = variants.sanitizeRules(s.rules, variant);
    if (s.customCards) room.settings.customCards = variant.rules.flip ? [] : variants.sanitizeCustomCards(s.customCards);
  }

  updateSettings(socket, settings) {
    const { room } = this.hostCtx(socket);
    this.assertLobby(room);
    this.applySettings(room, settings);
    this.broadcast(room);
  }

  addBot(socket) {
    const { room } = this.hostCtx(socket);
    this.assertLobby(room);
    if (room.members.length >= MAX_PLAYERS) throw new UserError(`Maximum ${MAX_PLAYERS} players`);
    const used = new Set(room.members.map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${room.members.length + 1}`;
    room.members.push({ id: uid(), name, isBot: true, token: null, socketId: null, connected: true });
    this.broadcast(room);
  }

  removeMember(socket, { memberId }) {
    const { room, member } = this.hostCtx(socket);
    this.assertLobby(room);
    const target = room.members.find((m) => m.id === memberId);
    if (!target || target === member) throw new UserError('Cannot remove that player');
    room.members = room.members.filter((m) => m !== target);
    if (target.socketId) {
      const s = this.io.sockets.sockets.get(target.socketId);
      if (s) {
        s.data = {};
        s.emit('room:kicked');
      }
    }
    room.game = null;
    this.broadcast(room);
  }

  start(socket) {
    const { room } = this.hostCtx(socket);
    this.assertLobby(room);
    if (room.members.length < 2) throw new UserError('You need at least 2 players — add a computer player');
    const variant = variants.get(room.settings.variant);
    const rules = variants.sanitizeRules(room.settings.rules, variant);
    room.game = new Game({ players: room.members, variant, rules, customCards: room.settings.customCards });
    room.game.start();
    room.catchKey = null;
    this.broadcast(room);
  }

  backToLobby(socket) {
    const { room } = this.hostCtx(socket);
    room.game = null;
    this.broadcast(room);
  }

  action(socket, action) {
    const { room, member } = this.ctx(socket);
    if (!room.game) throw new UserError('No game in progress');
    const err = room.game.act(member.id, action);
    if (err) return { ok: false, error: err };
    this.broadcast(room);
    return { ok: true };
  }

  // ---------- state + bots ----------

  broadcast(room) {
    room.lastActive = Date.now();
    const base = {
      code: room.code,
      hostId: room.hostId,
      settings: room.settings,
      maxPlayers: MAX_PLAYERS,
      members: room.members.map((m) => ({ id: m.id, name: m.name, isBot: m.isBot, connected: m.connected })),
    };
    for (const m of room.members) {
      if (m.isBot || !m.socketId) continue;
      this.io.to(m.socketId).emit('room:state', { ...base, youId: m.id, game: room.game ? room.game.view(m.id) : null });
    }
    this.scheduleBots(room);
  }

  isAutoPlayed(room, id) {
    const m = room.members.find((x) => x.id === id);
    const gp = room.game.byId(id);
    return { auto: gp.isBot || !m || m.isBot || !m.connected, bot: gp.isBot || !m || m.isBot };
  }

  scheduleBots(room) {
    clearTimeout(room.timers.bot);
    const g = room.game;
    if (!g || g.phase === 'over') return;

    const actorId = g.currentActorId();
    const { auto, bot } = this.isAutoPlayed(room, actorId);
    if (auto) {
      const delay = bot ? 900 + Math.random() * 900 : DISCONNECTED_GRACE_MS;
      room.timers.bot = setTimeout(() => this.runBot(room, actorId), delay);
    }

    // Give computer players a chance to catch someone who forgot to say UNO.
    const key = g.unoVulnerable ? `${g.unoVulnerable}:${g.logSeq}` : null;
    if (key && key !== room.catchKey) {
      room.catchKey = key;
      clearTimeout(room.timers.catch);
      const catchers = g.players.filter((p) => !p.out && p.id !== g.unoVulnerable && this.isAutoPlayed(room, p.id).bot);
      if (catchers.length && Math.random() < 0.6) {
        const catcher = catchers[Math.floor(Math.random() * catchers.length)];
        const target = g.unoVulnerable;
        room.timers.catch = setTimeout(() => {
          if (room.game === g && g.unoVulnerable === target && !g.act(catcher.id, { type: 'catch', targetId: target })) this.broadcast(room);
        }, 700 + Math.random() * 1500);
      }
    }
  }

  runBot(room, actorId) {
    const g = room.game;
    if (!g || g.phase === 'over' || g.currentActorId() !== actorId) return;
    const p = g.byId(actorId);
    if (g.phase === 'play' && p.hand.length === 2 && !p.saidUno && Math.random() < 0.8) g.act(p.id, { type: 'uno' });
    const a = botAction(g, p);
    let err = a ? g.act(p.id, a) : 'no action';
    if (err) {
      console.warn('[bot] action rejected:', err, a);
      // Fall back to something always legal for the phase.
      const fallbacks = [{ type: 'draw' }, { type: 'pass' }, { type: 'challenge', call: false }, { type: 'chooseColor', color: C.PALETTES[g.side][0] }];
      for (const f of fallbacks) if (!(err = g.act(p.id, f))) break;
    }
    this.broadcast(room);
  }
}

module.exports = { RoomManager };
