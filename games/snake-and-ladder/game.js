/* Snake & Ladder - core game logic: board layout, snakes/ladders, dice
   rolls, turn order. No DOM/canvas/network code here - works standalone
   in Node (for testing) or in the browser.

   Only the "authority" (the host, or the local player in practice mode)
   calls the mutating methods (rollDice, addPlayer, removePlayer). Everyone
   else just renders whatever state they're given - there's no hidden
   information in this game, so the state can be broadcast as-is. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SNL = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const BOARD_SIZE = 100;
  const MAX_PLAYERS = 4;
  const SIX_STREAK_BUST = 3;

  // classic-style layout, hand-picked so no square is used twice across
  // either set (no chained snake-into-ladder surprises)
  const LADDERS = { 2: 23, 8: 34, 20: 41, 28: 76, 40: 59, 50: 69, 63: 81, 71: 91 };
  const SNAKES = { 17: 4, 19: 7, 54: 32, 62: 18, 64: 60, 87: 24, 93: 68, 95: 42, 99: 78 };

  const TOKEN_COLORS = ['#f6c93b', '#4fd1c5', '#e05263', '#a78bfa'];
  const TOKEN_NAMES = ['Batman', 'Robin', 'Batgirl', 'Nightwing'];

  function squareToRowCol(n) {
    const idx = n - 1;
    const row = Math.floor(idx / 10); // 0 = bottom row
    let col = idx % 10;
    if (row % 2 === 1) col = 9 - col; // odd rows run right-to-left
    return { row, col };
  }

  function newPlayer(id, name, isBot, color) {
    return { id, name, isBot: !!isBot, color, pos: 0, active: true, connected: true };
  }

  function newTable() {
    return {
      players: [],
      currentIndex: 0,
      stage: 'waiting',   // waiting | playing | finished
      winner: null,
      lastRoll: null,
      lastEvent: null,     // {type:'ladder'|'snake', from, to} for the most recent move, for animation
      sixStreak: 0,
      turnNumber: 0,
      log: []
    };
  }

  function addLog(t, msg) {
    t.log.push(msg);
    if (t.log.length > 60) t.log.shift();
  }

  function addPlayer(t, id, name, isBot) {
    if (t.players.length >= MAX_PLAYERS) return null;
    if (t.players.some(p => p.id === id)) return t.players.find(p => p.id === id);
    const color = TOKEN_COLORS[t.players.length];
    const label = name || TOKEN_NAMES[t.players.length];
    const p = newPlayer(id, label, isBot, color);
    t.players.push(p);
    addLog(t, `${p.name} joined the table.`);
    return p;
  }

  function advanceTurn(t) {
    const n = t.players.length;
    if (!n) return;
    let guard = 0;
    do {
      t.currentIndex = (t.currentIndex + 1) % n;
      guard++;
    } while (!t.players[t.currentIndex].active && guard <= n);
    t.sixStreak = 0;
    t.turnNumber += 1;
  }

  function removePlayer(t, id) {
    const p = t.players.find(pl => pl.id === id);
    if (!p) return;
    p.connected = false;
    if (t.stage === 'playing' && p.active) {
      p.active = false;
      addLog(t, `${p.name} left the game.`);
      const wasActing = t.players[t.currentIndex] && t.players[t.currentIndex].id === id;
      if (wasActing) advanceTurn(t);
      if (t.players.filter(x => x.active).length < 1) t.stage = 'finished';
    }
  }

  function startGame(t) {
    if (t.players.length < 1) return false;
    t.stage = 'playing';
    t.currentIndex = 0;
    t.sixStreak = 0;
    t.turnNumber = 0;
    for (const p of t.players) { p.pos = 0; p.active = true; }
    if (!t.players[0].active) advanceTurn(t);
    addLog(t, `Let's go! ${t.players[0].name} rolls first.`);
    return true;
  }

  // returns {roll, extraTurn, event, won, bust} or null if illegal
  function rollDice(t, playerId) {
    if (t.stage !== 'playing') return null;
    const player = t.players[t.currentIndex];
    if (!player || player.id !== playerId) return null;

    const roll = 1 + Math.floor(Math.random() * 6);
    t.lastRoll = roll;
    t.lastEvent = null;

    if (roll === 6) {
      t.sixStreak += 1;
      if (t.sixStreak >= SIX_STREAK_BUST) {
        const from = player.pos;
        player.pos = 0;
        t.sixStreak = 0;
        addLog(t, `${player.name} rolled three 6s in a row - sent back to start!`);
        t.lastEvent = { type: 'bust', from, to: 0 };
        advanceTurn(t);
        return { roll, bust: true };
      }
    } else {
      t.sixStreak = 0;
    }

    const before = player.pos;
    const target = before + roll;
    let event = null;
    let won = false;

    if (target > BOARD_SIZE) {
      addLog(t, `${player.name} rolls a ${roll} - needs an exact count, stays on ${before}.`);
    } else {
      player.pos = target;
      if (LADDERS[target]) {
        const to = LADDERS[target];
        addLog(t, `${player.name} rolls a ${roll} and climbs a ladder: ${target} → ${to}!`);
        player.pos = to;
        event = { type: 'ladder', from: target, to };
      } else if (SNAKES[target]) {
        const to = SNAKES[target];
        addLog(t, `${player.name} rolls a ${roll} and is caught by a snake: ${target} → ${to}!`);
        player.pos = to;
        event = { type: 'snake', from: target, to };
      } else {
        addLog(t, `${player.name} rolls a ${roll}, now on square ${target}.`);
      }

      if (player.pos === BOARD_SIZE) {
        t.stage = 'finished';
        t.winner = player.id;
        won = true;
        addLog(t, `🦇 ${player.name} reaches square 100 and saves Gotham!`);
      }
    }

    t.lastEvent = event;
    const extraTurn = roll === 6 && !won;
    if (!won && !extraTurn) advanceTurn(t);
    else if (!won && extraTurn) addLog(t, `${player.name} rolled a 6 - go again!`);

    return { roll, extraTurn, event, won };
  }

  function serialize(t) {
    return {
      players: t.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot, color: p.color, pos: p.pos, active: p.active, connected: p.connected })),
      currentIndex: t.currentIndex,
      stage: t.stage,
      winner: t.winner,
      lastRoll: t.lastRoll,
      lastEvent: t.lastEvent,
      turnNumber: t.turnNumber,
      log: t.log.slice(-10)
    };
  }

  return {
    BOARD_SIZE, MAX_PLAYERS, LADDERS, SNAKES, TOKEN_COLORS, TOKEN_NAMES,
    squareToRowCol, newTable, addPlayer, removePlayer, startGame, rollDice, serialize, addLog
  };
});
