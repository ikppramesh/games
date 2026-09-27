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
  const LADDER_COUNT = 8;
  const SNAKE_COUNT = 8;
  const MIN_GAP = 6;   // shortest allowed rise/drop for a ladder or snake
  const MAX_SPAN = 35; // longest - keeps the board readable instead of a tangle

  const TOKEN_COLORS = ['#f6c93b', '#4fd1c5', '#e05263', '#a78bfa'];
  const TOKEN_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

  function squareToRowCol(n) {
    const idx = n - 1;
    const row = Math.floor(idx / 10); // 0 = bottom row
    let col = idx % 10;
    if (row % 2 === 1) col = 9 - col; // odd rows run right-to-left
    return { row, col };
  }

  // Every new table gets its own random layout - ladders (climb up) and
  // snakes (slide down) - so the board is different each game/refresh.
  // No square is ever reused across heads/tails/bottoms/tops, so nothing
  // chains into another feature.
  function generateBoard(rng) {
    rng = rng || Math.random;
    const used = new Set([1, BOARD_SIZE]);
    const ladders = {};
    const snakes = {};
    const ladderSegs = [], snakeSegs = [];

    function randInt(min, max) { return min + Math.floor(rng() * (max - min + 1)); }
    const rowOf = (n) => Math.floor((n - 1) / 10);
    const pt = (n) => { const { row, col } = squareToRowCol(n); return { x: col, y: row }; };

    // Keeps the board readable, like a printed one: every ladder/snake spans
    // at least one full row (none lie sideways), doesn't reach too far
    // across, and ladders never cross ladders, nor snakes cross snakes
    // (snakes crossing ladders is fine).
    function crosses(a, b, c, d) {
      const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    }
    function fits(lo, hi, segs) {
      if (rowOf(lo) === rowOf(hi)) return false;
      const a = pt(lo), b = pt(hi);
      if (Math.abs(a.x - b.x) > 4) return false;
      return !segs.some(([c, d]) => crosses(a, b, c, d));
    }

    function tryAddLadder() {
      for (let attempt = 0; attempt < 400; attempt++) {
        const bottom = randInt(2, 90);
        if (used.has(bottom) || bottom + MIN_GAP > 99) continue;
        const top = randInt(bottom + MIN_GAP, Math.min(99, bottom + MAX_SPAN));
        if (used.has(top) || !fits(bottom, top, ladderSegs)) continue;
        used.add(bottom); used.add(top);
        ladders[bottom] = top;
        ladderSegs.push([pt(bottom), pt(top)]);
        return;
      }
    }
    function tryAddSnake() {
      for (let attempt = 0; attempt < 400; attempt++) {
        const head = randInt(11, 99);
        if (used.has(head) || head - MIN_GAP < 2) continue;
        const tail = randInt(Math.max(2, head - MAX_SPAN), head - MIN_GAP);
        if (used.has(tail) || !fits(tail, head, snakeSegs)) continue;
        used.add(head); used.add(tail);
        snakes[head] = tail;
        snakeSegs.push([pt(tail), pt(head)]);
        return;
      }
    }

    for (let i = 0; i < LADDER_COUNT; i++) tryAddLadder();
    for (let i = 0; i < SNAKE_COUNT; i++) tryAddSnake();
    return { ladders, snakes };
  }

  function newPlayer(id, name, isBot, color) {
    return { id, name, isBot: !!isBot, color, pos: 0, active: true, connected: true };
  }

  function newTable() {
    const board = generateBoard();
    return {
      players: [],
      currentIndex: 0,
      stage: 'waiting',   // waiting | playing | finished
      winner: null,
      lastRoll: null,
      lastEvent: null,     // {type:'ladder'|'snake'|'bust', from, to} for the most recent move
      lastMove: null,      // {seq, playerId, from, landed, to, event} - drives the move animation
      moveSeq: 0,
      sixStreak: 0,
      turnNumber: 0,
      theme: 'classic',   // board theme id (see themes.js) - picked by the host
      colors: TOKEN_COLORS.slice(),
      ladders: board.ladders,
      snakes: board.snakes,
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
    const color = (t.colors || TOKEN_COLORS)[t.players.length];
    const label = name || TOKEN_NAMES[t.players.length];
    const p = newPlayer(id, label, isBot, color);
    t.players.push(p);
    addLog(t, `${p.name} joined the table.`);
    return p;
  }

  // switch theme (lobby only): recolour everyone, and rename computer
  // players to the new theme's names
  function setTheme(t, id, colors, botNames) {
    t.theme = id;
    if (colors) t.colors = colors.slice();
    t.players.forEach((p, i) => {
      if (colors) p.color = colors[i % colors.length];
      if (p.isBot && botNames) p.name = botNames[i % botNames.length] + ' (CPU)';
    });
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
        t.lastMove = { seq: ++t.moveSeq, playerId, from, landed: from, to: 0, event: t.lastEvent };
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
      if (t.ladders[target]) {
        const to = t.ladders[target];
        addLog(t, `${player.name} rolls a ${roll} and climbs a grapple line: ${target} → ${to}!`);
        player.pos = to;
        event = { type: 'ladder', from: target, to };
      } else if (t.snakes[target]) {
        const to = t.snakes[target];
        addLog(t, `${player.name} rolls a ${roll} and is swallowed by a snake: ${target} → ${to}!`);
        player.pos = to;
        event = { type: 'snake', from: target, to };
      } else {
        addLog(t, `${player.name} rolls a ${roll}, now on square ${target}.`);
      }

      if (player.pos === BOARD_SIZE) {
        t.stage = 'finished';
        t.winner = player.id;
        won = true;
        addLog(t, `🏆 ${player.name} reaches square 100 and wins!`);
      }
    }

    t.lastEvent = event;
    t.lastMove = { seq: ++t.moveSeq, playerId, from: before, landed: target > BOARD_SIZE ? before : target, to: player.pos, event };
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
      theme: t.theme,
      winner: t.winner,
      lastRoll: t.lastRoll,
      lastEvent: t.lastEvent,
      lastMove: t.lastMove,
      turnNumber: t.turnNumber,
      ladders: t.ladders,
      snakes: t.snakes,
      log: t.log.slice(-10)
    };
  }

  return {
    BOARD_SIZE, MAX_PLAYERS, TOKEN_COLORS, TOKEN_NAMES,
    squareToRowCol, generateBoard, newTable, addPlayer, setTheme, removePlayer, startGame, rollDice, serialize, addLog
  };
});
