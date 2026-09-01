/* Texas Hold'em - core game engine: deck, hand evaluation, betting state
   machine, side pots, and simple bots. No DOM/canvas/network code here -
   works standalone in Node (for testing) or in the browser.

   Only the "authority" (the host, or the local player in practice mode)
   calls the mutating methods (dealHand, applyAction, addBot, ...).
   Everyone else just renders whatever state they're given. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PK = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const SUITS = ['S', 'H', 'D', 'C'];
  const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const CATEGORY_NAMES = [
    'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
    'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'
  ];
  const STARTING_CHIPS = 1000;
  const SMALL_BLIND = 10;
  const BIG_BLIND = 20;
  const MAX_SEATS = 6;

  function rankLabel(r) { return RANK_NAMES[r] || String(r); }

  // ---------- deck ----------
  function freshDeck() {
    const deck = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
    return deck;
  }
  function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // ---------- hand evaluation ----------
  function combinations(arr, k) {
    const result = [];
    function helper(start, combo) {
      if (combo.length === k) { result.push(combo.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        helper(i + 1, combo);
        combo.pop();
      }
    }
    helper(0, []);
    return result;
  }

  function rank5(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);

    const uniq = [...new Set(ranks)];
    let isStraight = false, straightHigh = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) { isStraight = true; straightHigh = uniq[0]; }
      else if (uniq.join(',') === '14,5,4,3,2') { isStraight = true; straightHigh = 5; } // wheel: A-2-3-4-5
    }

    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const groups = Object.entries(counts)
      .map(([r, c]) => [Number(r), c])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    if (isStraight && isFlush) return [8, straightHigh];
    if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
    if (isFlush) return [5, ...ranks];
    if (isStraight) return [4, straightHigh];
    if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map(g => g[0])];
    if (groups[0][1] === 2 && groups[1][1] === 2) {
      const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
      return [2, pairs[0], pairs[1], groups[2][0]];
    }
    if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map(g => g[0])];
    return [0, ...ranks];
  }

  function compareRank(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] || 0, bv = b[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  // best 5-card hand out of 5..7 cards
  function bestHand(cards) {
    const pool = cards.length > 5 ? combinations(cards, 5) : [cards];
    let best = null;
    for (const combo of pool) {
      const r = rank5(combo);
      if (!best || compareRank(r, best.rank) > 0) best = { rank: r, cards: combo };
    }
    return best;
  }

  function handName(rank) {
    if (rank[0] === 8 && rank[1] === 14) return 'Royal Flush';
    return CATEGORY_NAMES[rank[0]];
  }

  // ---------- side pots ----------
  // players: [{id, totalBetThisHand, folded}] for everyone dealt into the hand
  function buildPots(players) {
    const contributors = players.filter(p => p.totalBetThisHand > 0);
    const levels = [...new Set(contributors.map(p => p.totalBetThisHand))].sort((a, b) => a - b);
    const pots = [];
    let prevLevel = 0;
    for (const level of levels) {
      const layer = level - prevLevel;
      const payers = contributors.filter(p => p.totalBetThisHand >= level);
      const amount = layer * payers.length;
      const eligiblePlayerIds = payers.filter(p => !p.folded).map(p => p.id);
      if (amount > 0) pots.push({ amount, eligiblePlayerIds });
      prevLevel = level;
    }
    return pots;
  }

  // ---------- table / hand state machine ----------
  function newPlayer(id, name, chips, seat, isBot) {
    return {
      id, name, seat, isBot: !!isBot,
      chips: chips == null ? STARTING_CHIPS : chips,
      holeCards: [], folded: false, allIn: false, hasActed: false,
      betThisRound: 0, totalBetThisHand: 0, bustedOut: false, connected: true,
      lastAction: null
    };
  }

  function newTable() {
    return {
      players: [],           // seated, in seat order
      dealerSeat: -1,
      smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND,
      deck: [],
      community: [],
      pot: 0,
      pots: [],               // resolved side pots (only populated at showdown)
      stage: 'waiting',        // waiting | preflop | flop | turn | river | showdown
      currentBet: 0,
      minRaise: BIG_BLIND,
      actingId: null,
      pendingActions: 0,
      handNumber: 0,
      winners: [],             // [{id, name, amount, handName}] from the last resolved hand
      log: []
    };
  }

  function addLog(t, msg) {
    t.log.push(msg);
    if (t.log.length > 60) t.log.shift();
  }

  function activePlayers(t) { return t.players.filter(p => !p.folded && !p.bustedOut); }
  function contestingPlayers(t) { return t.players.filter(p => !p.folded && !p.bustedOut && !p.allIn); }

  function seatOrderFrom(t, startSeatIdx) {
    // returns players array rotated to start right after startSeatIdx, only non-busted
    const seated = t.players.filter(p => !p.bustedOut);
    if (!seated.length) return [];
    const startPos = t.players.indexOf(t.players.find(p => p.seat === startSeatIdx));
    const order = [];
    for (let i = 1; i <= t.players.length; i++) {
      const p = t.players[(startPos + i) % t.players.length];
      if (p && !p.bustedOut) order.push(p);
    }
    return order;
  }

  function addPlayer(t, id, name, isBot) {
    if (t.players.length >= MAX_SEATS) return null;
    if (t.players.some(p => p.id === id)) return t.players.find(p => p.id === id);
    const seat = t.players.length;
    const p = newPlayer(id, name, STARTING_CHIPS, seat, isBot);
    t.players.push(p);
    addLog(t, `${name} joined the table.`);
    return p;
  }

  function removePlayer(t, id) {
    const p = t.players.find(p => p.id === id);
    if (!p) return;
    if (t.stage !== 'waiting' && t.stage !== 'showdown' && !p.folded && !p.bustedOut) {
      const wasActing = t.actingId === id;
      p.folded = true; // treat a disconnect mid-hand as a fold
      addLog(t, `${p.name} left and folded.`);
      if (wasActing) t.pendingActions -= 1;
      checkForUncontested(t);
      // if it was their turn, someone (or the next stage) has to take over -
      // otherwise actingId would keep pointing at a player who'll never act again
      if (wasActing) advanceTurn(t, p.seat);
    }
    p.connected = false;
  }

  // Shared "who goes next" logic after a player's turn resolves (used by
  // both applyAction and a disconnect that happens to be mid-turn).
  function advanceTurn(t, afterSeat) {
    if (t.stage === 'showdown') return;
    if (isRoundOver(t)) {
      nextStage(t);
    } else {
      const order = seatOrderFrom(t, afterSeat).filter(x => !x.folded && !x.bustedOut && !x.allIn);
      t.actingId = order.length ? order[0].id : null;
      if (!t.actingId) nextStage(t);
    }
  }

  function nextDealerSeat(t) {
    const seated = t.players.filter(p => !p.bustedOut);
    if (!seated.length) return -1;
    if (t.dealerSeat === -1) return seated[0].seat;
    const seats = seated.map(p => p.seat).sort((a, b) => a - b);
    const idx = seats.indexOf(t.dealerSeat);
    return seats[(idx + 1) % seats.length] != null ? seats[(idx === -1 ? 0 : idx + 1) % seats.length] : seats[0];
  }

  function dealHand(t) {
    const eligible = t.players.filter(p => !p.bustedOut && p.chips > 0);
    if (eligible.length < 2) { t.stage = 'waiting'; return false; }

    t.handNumber += 1;
    t.deck = shuffle(freshDeck());
    t.community = [];
    t.pot = 0;
    t.pots = [];
    t.winners = [];
    t.currentBet = 0;
    t.minRaise = t.bigBlind;
    for (const p of t.players) {
      p.holeCards = []; p.folded = p.bustedOut || p.chips <= 0; p.allIn = false;
      p.hasActed = false; p.betThisRound = 0; p.totalBetThisHand = 0; p.lastAction = null;
    }

    t.dealerSeat = nextDealerSeat(t);
    const order = seatOrderFrom(t, t.dealerSeat); // players after dealer, in action order
    const activeOrder = order.filter(p => !p.folded);

    // deal 2 hole cards each, starting left of dealer
    for (const p of activeOrder) p.holeCards = [t.deck.pop(), t.deck.pop()];

    // blinds
    const sbPlayer = activeOrder[0 % activeOrder.length];
    const bbPlayer = activeOrder[1 % activeOrder.length];
    postBet(t, sbPlayer, t.smallBlind);
    postBet(t, bbPlayer, t.bigBlind);
    t.currentBet = t.bigBlind;
    sbPlayer.lastAction = 'small blind';
    bbPlayer.lastAction = 'big blind';

    t.stage = 'preflop';
    startBettingRound(t, activeOrder.length >= 2 ? (activeOrder[2 % activeOrder.length] || bbPlayer) : bbPlayer, true);
    addLog(t, `Hand #${t.handNumber} - ${sbPlayer.name} posts SB ${t.smallBlind}, ${bbPlayer.name} posts BB ${t.bigBlind}.`);
    return true;
  }

  function postBet(t, p, amount) {
    const actual = Math.min(amount, p.chips);
    p.chips -= actual;
    p.betThisRound += actual;
    p.totalBetThisHand += actual;
    t.pot += actual;
    if (p.chips === 0) p.allIn = true;
  }

  function startBettingRound(t, firstActor, isPreflop) {
    if (!isPreflop) for (const p of t.players) { p.betThisRound = 0; p.hasActed = false; }
    if (activePlayers(t).length <= 1) { resolveShowdown(t); return; }

    const eligible = contestingPlayers(t);
    if (eligible.length === 0) {
      // nobody left who can act (everyone remaining is all-in) - keep dealing
      // streets automatically until the board is complete, then showdown.
      t.actingId = null;
      nextStage(t);
      return;
    }
    t.pendingActions = eligible.length;
    t.actingId = firstActor ? firstActor.id : eligible[0].id;
  }

  function isRoundOver(t) {
    return t.pendingActions <= 0 || contestingPlayers(t).length === 0;
  }

  function nextStage(t) {
    if (t.stage === 'preflop') { t.community.push(t.deck.pop(), t.deck.pop(), t.deck.pop()); t.stage = 'flop'; }
    else if (t.stage === 'flop') { t.community.push(t.deck.pop()); t.stage = 'turn'; }
    else if (t.stage === 'turn') { t.community.push(t.deck.pop()); t.stage = 'river'; }
    else if (t.stage === 'river') { resolveShowdown(t); return; }

    t.currentBet = 0;
    for (const p of t.players) { p.betThisRound = 0; p.hasActed = false; }
    if (activePlayers(t).length <= 1) { resolveShowdown(t); return; }

    const order = seatOrderFrom(t, t.dealerSeat).filter(p => !p.folded && !p.bustedOut);
    const firstActor = order.find(p => !p.allIn) || null;
    startBettingRound(t, firstActor, false);
    addLog(t, `-- ${t.stage.toUpperCase()} -- ${t.community.slice(-(t.stage === 'flop' ? 3 : 1)).map(cardLabel).join(' ')}`);
  }

  function checkForUncontested(t) {
    const remaining = activePlayers(t);
    if (remaining.length === 1 && t.stage !== 'waiting' && t.stage !== 'showdown') {
      awardUncontested(t, remaining[0]);
    }
  }

  function awardUncontested(t, winner) {
    winner.chips += t.pot;
    t.winners = [{ id: winner.id, name: winner.name, amount: t.pot, handName: null }];
    addLog(t, `${winner.name} wins ${t.pot} chips (everyone else folded).`);
    t.pot = 0;
    t.stage = 'showdown';
    t.actingId = null;
    markBusted(t);
  }

  function resolveShowdown(t) {
    const contenders = t.players.filter(p => !p.folded && !p.bustedOut);
    const pots = buildPots(t.players);
    t.pots = pots;
    const results = {};
    for (const pot of pots) {
      const eligible = contenders.filter(p => pot.eligiblePlayerIds.includes(p.id));
      if (!eligible.length) continue;
      let bestRank = null;
      const scored = eligible.map(p => {
        const b = bestHand(p.holeCards.concat(t.community));
        return { p, rank: b.rank };
      });
      for (const s of scored) if (!bestRank || compareRank(s.rank, bestRank) > 0) bestRank = s.rank;
      const winners = scored.filter(s => compareRank(s.rank, bestRank) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const w of winners) {
        const extra = remainder > 0 ? 1 : 0;
        if (extra) remainder -= 1;
        w.p.chips += share + extra;
        results[w.p.id] = results[w.p.id] || { id: w.p.id, name: w.p.name, amount: 0, handName: handName(bestRank) };
        results[w.p.id].amount += share + extra;
      }
    }
    t.winners = Object.values(results);
    for (const r of t.winners) addLog(t, `${r.name} wins ${r.amount} chips${r.handName ? ' with ' + r.handName : ''}.`);
    t.pot = 0;
    t.stage = 'showdown';
    t.actingId = null;
    markBusted(t);
  }

  function markBusted(t) {
    for (const p of t.players) {
      if (!p.bustedOut && p.chips <= 0) { p.bustedOut = true; addLog(t, `${p.name} is out of chips.`); }
    }
  }

  // legalActions: what the currently-acting player may do
  function legalActions(t, playerId) {
    const p = t.players.find(pl => pl.id === playerId);
    if (!p || t.actingId !== playerId) return null;
    const toCall = t.currentBet - p.betThisRound;
    return {
      canCheck: toCall <= 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, p.chips),
      canBetOrRaise: p.chips > toCall,
      minRaiseTo: t.currentBet + t.minRaise,
      maxRaiseTo: p.betThisRound + p.chips,
      chips: p.chips
    };
  }

  // action: {kind: 'fold'|'check'|'call'|'bet'|'raise'|'allin', amount?}
  // amount for bet/raise is the TOTAL betThisRound they want to reach (not the delta)
  function applyAction(t, playerId, action) {
    const p = t.players.find(pl => pl.id === playerId);
    if (!p || t.actingId !== playerId || t.stage === 'waiting' || t.stage === 'showdown') return false;
    const toCall = t.currentBet - p.betThisRound;

    if (action.kind === 'fold') {
      p.folded = true; p.lastAction = 'folded';
      addLog(t, `${p.name} folds.`);
      t.pendingActions -= 1;
      checkForUncontested(t);
      if (t.stage === 'showdown') return true;
    } else if (action.kind === 'check') {
      if (toCall > 0) return false;
      p.lastAction = 'checks';
      addLog(t, `${p.name} checks.`);
      t.pendingActions -= 1;
    } else if (action.kind === 'call' || action.kind === 'allin' && toCall >= p.chips) {
      const amt = Math.min(toCall, p.chips);
      postBet(t, p, amt);
      p.lastAction = p.allIn ? 'calls all-in' : 'calls';
      addLog(t, `${p.name} ${p.allIn ? 'calls all-in for ' + amt : 'calls ' + amt}.`);
      t.pendingActions -= 1;
    } else if (action.kind === 'bet' || action.kind === 'raise' || action.kind === 'allin') {
      let targetTotal = action.kind === 'allin' ? p.betThisRound + p.chips : Math.max(action.amount || 0, t.currentBet + t.minRaise);
      targetTotal = Math.min(targetTotal, p.betThisRound + p.chips);
      const delta = targetTotal - p.betThisRound;
      if (delta <= 0) return false;
      const raiseSize = targetTotal - t.currentBet;
      postBet(t, p, delta);
      if (raiseSize > t.minRaise) t.minRaise = raiseSize;
      t.currentBet = Math.max(t.currentBet, p.betThisRound);
      p.lastAction = p.allIn ? 'raises all-in to ' + p.betThisRound : (action.kind === 'bet' ? 'bets ' + p.betThisRound : 'raises to ' + p.betThisRound);
      addLog(t, `${p.name} ${p.lastAction}.`);
      // everyone else who isn't folded/all-in must act again
      t.pendingActions = contestingPlayers(t).filter(x => x.id !== p.id).length;
    } else {
      return false;
    }

    if (t.stage === 'showdown') return true; // hand ended via fold-out
    advanceTurn(t, p.seat);
    return true;
  }

  // ---------- bots ----------
  function estimateStrength(p, t) {
    const cards = p.holeCards.concat(t.community);
    if (cards.length >= 5) {
      const r = bestHand(cards).rank;
      return Math.min(1, (r[0] + 1) / 9 + Math.random() * 0.08);
    }
    const [a, b] = p.holeCards;
    if (!a || !b) return 0.3;
    let s = (a.rank + b.rank) / 28;
    if (a.rank === b.rank) s = 0.55 + a.rank / 40;
    if (a.suit === b.suit) s += 0.04;
    if (Math.abs(a.rank - b.rank) === 1) s += 0.02;
    return Math.min(1, s);
  }

  function botAction(t, playerId) {
    const p = t.players.find(pl => pl.id === playerId);
    const legal = legalActions(t, playerId);
    if (!p || !legal) return { kind: 'check' };
    const strength = estimateStrength(p, t);
    const potOdds = legal.callAmount / Math.max(1, t.pot + legal.callAmount);
    const rnd = Math.random();

    if (legal.canCall && legal.callAmount > 0) {
      if (strength < 0.22 && legal.callAmount > p.chips * 0.08 && rnd < 0.75) return { kind: 'fold' };
      if (strength > 0.72 && legal.canBetOrRaise && rnd < 0.45) {
        const raiseTo = Math.min(legal.maxRaiseTo, legal.minRaiseTo + Math.floor(t.pot * 0.5));
        return { kind: 'raise', amount: raiseTo };
      }
      if (strength + 0.15 < potOdds && rnd < 0.5) return { kind: 'fold' };
      return { kind: 'call' };
    }
    if (strength > 0.65 && legal.canBetOrRaise && rnd < 0.5) {
      const betTo = Math.min(legal.maxRaiseTo, t.currentBet + Math.max(t.bigBlind, Math.floor((t.pot || t.bigBlind) * 0.6)));
      return { kind: 'bet', amount: betTo };
    }
    return { kind: 'check' };
  }

  // ---------- serialization (hide other players' hole cards) ----------
  function cardLabel(c) { return rankLabel(c.rank) + c.suit; }

  function serializeFor(t, viewerId) {
    return {
      stage: t.stage,
      dealerSeat: t.dealerSeat,
      smallBlind: t.smallBlind, bigBlind: t.bigBlind,
      community: t.community.slice(),
      pot: t.pot,
      pots: t.pots,
      currentBet: t.currentBet,
      minRaise: t.minRaise,
      actingId: t.actingId,
      handNumber: t.handNumber,
      winners: t.winners,
      log: t.log.slice(-8),
      players: t.players.map(p => ({
        id: p.id, name: p.name, seat: p.seat, isBot: p.isBot, chips: p.chips,
        folded: p.folded, allIn: p.allIn, bustedOut: p.bustedOut, connected: p.connected,
        betThisRound: p.betThisRound, totalBetThisHand: p.totalBetThisHand, lastAction: p.lastAction,
        holeCards: (p.id === viewerId || t.stage === 'showdown')
          ? p.holeCards
          : p.holeCards.map(() => null) // hidden, but count is visible so opponents show face-down cards
      }))
    };
  }

  return {
    SUITS, MAX_SEATS, STARTING_CHIPS, SMALL_BLIND, BIG_BLIND, CATEGORY_NAMES,
    rankLabel, cardLabel, freshDeck, shuffle,
    rank5, compareRank, bestHand, handName, buildPots,
    newTable, addPlayer, removePlayer, dealHand, applyAction, legalActions,
    botAction, estimateStrength, serializeFor, checkForUncontested, addLog
  };
});
