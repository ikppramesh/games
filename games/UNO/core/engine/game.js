'use strict';
const C = require('./cards');
const variants = require('../variants');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One round of UNO. Rules come from the variant plus any lobby overrides.
// All mutations go through act(); it returns an error string or null.
//
// Phases:
//   play           current player plays / draws / passes
//   chooseColor    a Flip card landed on a wild: the flipper picks a colour
//   liarChallenge  Liar's UNO: next player believes or calls the bluff
//   roulette       Colour Roulette: next player picks a colour to draw towards
//   over           someone won
class Game {
  constructor({ players, variant, rules, customCards }) {
    this.variant = variant;
    this.rules = rules;
    this.customCards = rules.flip ? [] : (customCards || []);
    this.players = players.map((p) => ({ id: p.id, name: p.name, isBot: !!p.isBot, hand: [], out: false, saidUno: false }));
    this.log = [];
    this.logSeq = 0;
    this.nextCardId = 1;
  }

  // ---------- setup ----------

  makeCards() {
    const sets = this.variant.buildDeck().concat(variants.buildCustomCards(this.customCards));
    return sets.map((faces) => ({ id: this.nextCardId++, faces }));
  }

  start() {
    let deck = this.makeCards();
    const need = this.players.length * this.rules.handSize + 30;
    while (deck.length < need) deck = deck.concat(this.makeCards());

    // Every distinct face in the deck (used for Liar's UNO claims).
    const seen = new Map();
    for (const c of deck) for (const f of c.faces) seen.set(C.faceKey(f) + '|' + f.color, f);
    this.uniqueFaces = [...seen.values()];

    this.drawPile = shuffle(deck);
    this.discard = [];
    this.side = 0;
    this.direction = 1;
    this.pendingDraw = 0;
    this.drawnCardId = null;
    this.unoVulnerable = null;
    this.pending = null;
    this.winnerId = null;
    this.lastReveal = null;

    for (let r = 0; r < this.rules.handSize; r++) {
      for (const p of this.players) p.hand.push(this.drawPile.pop());
    }

    // The starting card must be a plain number card.
    const skipped = [];
    let first = this.drawPile.pop();
    while (first && this.face(first).type !== 'number') {
      skipped.push(first);
      first = this.drawPile.pop();
    }
    if (!first) first = skipped.pop();
    this.drawPile = shuffle(this.drawPile.concat(skipped));
    this.discard.push({ card: first, claim: null });
    const f = this.face(first);
    this.color = C.isWild(f) ? this.palette()[0] : f.color;

    this.turn = Math.floor(Math.random() * this.players.length);
    this.phase = 'play';
    this.addLog(['Game on! ', { player: this.players[this.turn].name }, ' goes first.']);
  }

  // ---------- helpers ----------

  face(card) { return card.faces[Math.min(this.side, card.faces.length - 1)]; }
  backFace(card) { return card.faces.length > 1 ? card.faces[1 - this.side] : null; }
  palette() { return C.PALETTES[this.side]; }
  topEntry() { return this.discard[this.discard.length - 1]; }
  topFace() { const e = this.topEntry(); return e.claim || this.face(e.card); }
  byId(id) { return this.players.find((p) => p.id === id); }
  activeCount() { return this.players.filter((p) => !p.out).length; }
  canPlayFace(f) { return C.canPlay(f, this.topFace(), this.color, this.pendingDraw); }

  nextIndex(from, dir = this.direction) {
    const n = this.players.length;
    let i = from;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!this.players[i].out) return i;
    }
    return from;
  }

  advance(steps) {
    for (let s = 0; s < steps; s++) this.turn = this.nextIndex(this.turn);
  }

  addLog(parts) {
    this.log.push({ seq: ++this.logSeq, parts });
    if (this.log.length > 200) this.log.shift();
  }

  currentActorId() {
    switch (this.phase) {
      case 'play': return this.players[this.turn].id;
      case 'chooseColor': return this.pending.chooserId;
      case 'liarChallenge': return this.pending.challengerId;
      case 'roulette': return this.pending.victimId;
      default: return null;
    }
  }

  legalClaims() {
    return this.uniqueFaces.filter((f) => this.canPlayFace(f)).map(C.cleanFace);
  }

  // ---------- drawing ----------

  reshuffle() {
    // During a Liar's challenge the card under the bluff must survive (it comes back if the bluff is caught).
    const keep = this.phase === 'liarChallenge' ? 2 : 1;
    if (this.discard.length > keep) {
      const kept = this.discard.splice(this.discard.length - keep, keep);
      this.drawPile = shuffle(this.discard.map((e) => e.card)).concat(this.drawPile);
      this.discard = kept;
      this.addLog(['The discard pile was shuffled into a new draw pile.']);
    } else {
      // Every card is in someone's hand: open a fresh deck so the game can't stall.
      this.drawPile = shuffle(this.makeCards()).concat(this.drawPile);
      this.addLog(['Out of cards — a fresh deck was opened.']);
    }
  }

  drawCard() {
    if (!this.drawPile.length) this.reshuffle();
    return this.drawPile.pop() || null;
  }

  atMercyLimit(p) {
    return this.rules.mercyLimit > 0 && p.hand.length >= this.rules.mercyLimit;
  }

  give(p, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      const c = this.drawCard();
      if (!c) break;
      p.hand.push(c);
      got++;
    }
    this.afterDraw(p);
    return got;
  }

  drawUntilColor(p, color) {
    let count = 0;
    for (;;) {
      const c = this.drawCard();
      if (!c) break;
      p.hand.push(c);
      count++;
      if (this.face(c).color === color || this.atMercyLimit(p)) break;
    }
    this.addLog([{ player: p.name }, ` draws ${count} card${count === 1 ? '' : 's'} hunting for `, { color }, '.']);
    this.afterDraw(p);
  }

  afterDraw(p) {
    if (p.hand.length > 1) {
      p.saidUno = false;
      if (this.unoVulnerable === p.id) this.unoVulnerable = null;
    }
    if (!p.out && this.atMercyLimit(p)) {
      p.out = true;
      this.drawPile = shuffle(this.drawPile.concat(p.hand));
      p.hand = [];
      this.addLog([{ player: p.name }, ` reached ${this.rules.mercyLimit} cards and is OUT (no mercy)!`]);
      if (this.activeCount() === 1) this.finish(this.players.find((x) => !x.out));
    }
  }

  finish(p) {
    this.phase = 'over';
    this.pending = null;
    this.pendingDraw = 0;
    this.winnerId = p.id;
    this.addLog([{ player: p.name }, ' wins the game!']);
  }

  clearUnoWindow(actor) {
    if (this.unoVulnerable && this.unoVulnerable !== actor.id) this.unoVulnerable = null;
  }

  // ---------- actions ----------

  act(playerId, action) {
    const p = this.byId(playerId);
    if (!p) return 'You are not in this game';
    if (this.phase === 'over') return 'The game is over';
    if (p.out) return 'You are out of this game';
    if (!action || typeof action !== 'object') return 'Bad action';
    switch (action.type) {
      case 'play': return this.play(p, action);
      case 'draw': return this.draw(p);
      case 'pass': return this.pass(p);
      case 'uno': return this.sayUno(p);
      case 'catch': return this.catchUno(p, action.targetId);
      case 'challenge': return this.challenge(p, !!action.call);
      case 'chooseColor': return this.chooseColor(p, action.color);
      default: return 'Unknown action';
    }
  }

  isTurn(p) {
    return this.phase === 'play' && this.players[this.turn] === p;
  }

  play(p, a) {
    if (!this.isTurn(p)) return 'It is not your turn';
    const idx = p.hand.findIndex((c) => c.id === a.cardId);
    if (idx < 0) return 'That card is not in your hand';
    if (this.drawnCardId != null && a.cardId !== this.drawnCardId) return 'You can only play the card you just drew (or pass)';

    const card = p.hand[idx];
    const real = this.face(card);
    let played = real;
    if (this.rules.liar && a.claim) {
      played = this.legalClaims().find((f) => C.sameFace(f, a.claim));
      if (!played) return 'You cannot claim that card here';
    } else if (!this.canPlayFace(real)) {
      return this.pendingDraw > 0 ? `Stack a draw card of +${this.topFace().draw} or more, or draw ${this.pendingDraw}` : 'That card does not match';
    }

    const opts = {};
    if (C.needsColorChoice(played)) {
      if (!this.palette().includes(a.color)) return 'Choose a colour';
      opts.color = a.color;
    }
    if (this.rules.sevenZero && played.type === 'number' && played.value === 7) {
      const others = this.players.filter((o) => !o.out && o !== p);
      const target = others.length === 1 ? others[0] : others.find((o) => o.id === a.targetId);
      if (!target) return 'Choose a player to swap hands with';
      opts.targetId = target.id;
    }

    this.clearUnoWindow(p);
    p.hand.splice(idx, 1);
    this.drawnCardId = null;
    this.lastReveal = null;
    if (p.hand.length === 1 && !p.saidUno) this.unoVulnerable = p.id;

    if (this.rules.liar) {
      this.discard.push({ card, claim: played });
      const challenger = this.players[this.nextIndex(this.turn)];
      this.phase = 'liarChallenge';
      this.pending = { liarId: p.id, challengerId: challenger.id, claim: played, card, opts };
      this.addLog([{ player: p.name }, ' plays a card face-down, claiming ', { face: played }, opts.color ? ' → ' : '', opts.color ? { color: opts.color } : '', '. Will ', { player: challenger.name }, ' believe it?']);
      return null;
    }

    this.discard.push({ card, claim: null });
    this.resolvePlay(p, played, opts, true);
    return null;
  }

  // Apply the effects of a card that has landed on the discard pile.
  resolvePlay(p, face, opts, announce) {
    this.turn = this.players.indexOf(p);
    if (announce) this.addLog([{ player: p.name }, ' played ', { face }, opts.color ? ' → ' : '', opts.color ? { color: opts.color } : '']);
    if (C.needsColorChoice(face)) this.color = opts.color;
    else if (!C.isWild(face)) this.color = face.color;

    if (face.type === 'discardAll') {
      const same = p.hand.filter((c) => this.face(c).color === face.color);
      if (same.length) {
        p.hand = p.hand.filter((c) => !same.includes(c));
        this.discard.splice(this.discard.length - 1, 0, ...same.map((card) => ({ card, claim: null })));
        this.addLog([{ player: p.name }, ` discards ${same.length} more `, { color: face.color }, ` card${same.length === 1 ? '' : 's'}.`]);
      }
      if (p.hand.length === 1 && !p.saidUno) this.unoVulnerable = p.id;
    }

    if (p.hand.length === 0) return this.finish(p);

    switch (face.type) {
      case 'number':
        if (this.rules.sevenZero && face.value === 7) this.swapHands(p, this.byId(opts.targetId));
        if (this.rules.sevenZero && face.value === 0) this.rotateHands();
        this.advance(1);
        break;
      case 'skip':
        this.addLog([{ player: this.players[this.nextIndex(this.turn)].name }, ' is skipped.']);
        this.advance(2);
        break;
      case 'reverse':
        this.direction *= -1;
        if (this.activeCount() === 2) this.addLog([{ player: p.name }, ' goes again.']);
        else this.advance(1);
        break;
      case 'skipAll':
        this.addLog(['Everyone is skipped — ', { player: p.name }, ' goes again.']);
        break;
      case 'draw':
      case 'wildDraw':
        this.applyDraw(face.draw);
        break;
      case 'wildReverseDraw':
        this.direction *= -1;
        this.applyDraw(face.draw);
        break;
      case 'flip':
        this.doFlip(p);
        break;
      case 'colorRoulette': {
        const victim = this.players[this.nextIndex(this.turn)];
        this.phase = 'roulette';
        this.pending = { victimId: victim.id };
        this.addLog(['Colour Roulette! ', { player: victim.name }, ' must pick a colour and draw until it appears.']);
        break;
      }
      case 'wildDrawColor': {
        const v = this.nextIndex(this.turn);
        this.drawUntilColor(this.players[v], opts.color);
        if (this.phase === 'over') return;
        this.turn = this.nextIndex(v);
        break;
      }
      default:
        this.advance(1);
    }
  }

  applyDraw(n) {
    if (this.rules.stacking) {
      this.pendingDraw += n;
      this.advance(1);
      this.addLog([{ player: this.players[this.turn].name }, ` must stack a draw card or take ${this.pendingDraw}!`]);
      return;
    }
    const v = this.nextIndex(this.turn);
    const victim = this.players[v];
    this.addLog([{ player: victim.name }, ` draws ${n} and loses their turn.`]);
    this.give(victim, n);
    if (this.phase === 'over') return;
    this.turn = this.nextIndex(v);
  }

  doFlip(p) {
    this.side = 1 - this.side;
    this.addLog([{ player: p.name }, ` flipped everything to the ${this.side ? 'DARK' : 'LIGHT'} side!`]);
    const top = this.topFace();
    if (C.isWild(top)) {
      this.phase = 'chooseColor';
      this.pending = { chooserId: p.id };
      return;
    }
    this.color = top.color;
    this.advance(1);
  }

  swapHands(a, b) {
    if (!b) return;
    [a.hand, b.hand] = [b.hand, a.hand];
    a.saidUno = b.saidUno = false;
    this.unoVulnerable = null;
    this.addLog([{ player: a.name }, ' swaps hands with ', { player: b.name }, '.']);
  }

  rotateHands() {
    const newHands = new Map();
    this.players.forEach((pl, i) => {
      if (!pl.out) newHands.set(this.nextIndex(i), pl.hand);
    });
    for (const [i, hand] of newHands) {
      this.players[i].hand = hand;
      this.players[i].saidUno = false;
    }
    this.unoVulnerable = null;
    this.addLog(['Everyone passes their hand ', this.direction === 1 ? 'clockwise' : 'counter-clockwise', '!']);
  }

  draw(p) {
    if (!this.isTurn(p)) return 'It is not your turn';
    if (this.drawnCardId != null) return 'You already drew — play that card or pass';
    this.clearUnoWindow(p);
    const pi = this.turn;

    if (this.pendingDraw > 0) {
      const n = this.pendingDraw;
      this.pendingDraw = 0;
      this.addLog([{ player: p.name }, ` takes the stacked penalty: ${n} cards!`]);
      this.give(p, n);
      if (this.phase === 'over') return null;
      this.turn = this.nextIndex(pi);
      return null;
    }

    if (this.rules.liar) {
      this.give(p, 1);
      this.addLog([{ player: p.name }, ' draws a card.']);
      if (this.phase !== 'over') this.turn = this.nextIndex(pi);
      return null;
    }

    let drawn = null;
    let count = 0;
    for (;;) {
      const c = this.drawCard();
      if (!c) break;
      p.hand.push(c);
      count++;
      if (this.canPlayFace(this.face(c))) { drawn = c; break; }
      if (!this.rules.drawUntilPlayable || this.atMercyLimit(p)) break;
    }
    this.addLog([{ player: p.name }, ` drew ${count} card${count === 1 ? '' : 's'}.`]);
    this.afterDraw(p);
    if (this.phase === 'over') return null;
    if (p.out) { this.turn = this.nextIndex(pi); return null; }
    if (drawn) { this.drawnCardId = drawn.id; return null; }
    this.turn = this.nextIndex(pi);
    return null;
  }

  pass(p) {
    if (!this.isTurn(p)) return 'It is not your turn';
    if (this.drawnCardId == null) return 'Draw a card first';
    this.drawnCardId = null;
    this.addLog([{ player: p.name }, ' passes.']);
    this.advance(1);
    return null;
  }

  sayUno(p) {
    if (p.hand.length > 2) return 'You can only call UNO with 2 or fewer cards';
    if (p.saidUno) return null;
    p.saidUno = true;
    if (this.unoVulnerable === p.id) this.unoVulnerable = null;
    this.addLog([{ player: p.name }, ' shouts UNO!']);
    return null;
  }

  catchUno(p, targetId) {
    if (!this.unoVulnerable || this.unoVulnerable !== targetId || targetId === p.id) return 'Nobody to catch';
    const t = this.byId(targetId);
    this.unoVulnerable = null;
    this.give(t, 2);
    this.addLog([{ player: p.name }, ' caught ', { player: t.name }, ' forgetting to say UNO! +2 cards.']);
    return null;
  }

  challenge(p, call) {
    if (this.phase !== 'liarChallenge' || this.pending.challengerId !== p.id) return 'Nothing to challenge';
    this.clearUnoWindow(p);
    const { liarId, claim, card, opts } = this.pending;
    const liar = this.byId(liarId);
    this.phase = 'play';
    this.pending = null;

    if (!call) {
      this.addLog([{ player: p.name }, ' believes ', { player: liar.name }, '.']);
      this.resolvePlay(liar, claim, opts, false);
      return null;
    }

    const real = this.face(card);
    const honest = C.sameFace(real, claim);
    this.lastReveal = { seq: this.logSeq + 1, face: C.cleanFace(real), claim, honest, liarId, challengerId: p.id };
    if (honest) {
      this.addLog([{ player: p.name }, ' called LIAR — but ', { player: liar.name }, ' told the truth! ', { player: p.name }, ' draws 2.']);
      this.give(p, 2);
      if (this.phase === 'over') return null;
      this.resolvePlay(liar, claim, opts, false);
      return null;
    }
    this.addLog([{ player: p.name }, ' caught ', { player: liar.name }, ' bluffing! It was really ', { face: real }, '. Card back + 2 cards.']);
    this.discard.pop();
    liar.hand.push(card);
    this.give(liar, 2);
    if (this.phase === 'over') return null;
    this.turn = this.nextIndex(this.players.indexOf(liar));
    return null;
  }

  chooseColor(p, color) {
    if (!this.palette().includes(color)) return 'Pick a valid colour';
    if (this.phase === 'roulette' && this.pending.victimId === p.id) {
      this.clearUnoWindow(p);
      const vi = this.players.indexOf(p);
      this.color = color;
      this.phase = 'play';
      this.pending = null;
      this.drawUntilColor(p, color);
      if (this.phase === 'over') return null;
      this.turn = this.nextIndex(vi);
      return null;
    }
    if (this.phase === 'chooseColor' && this.pending.chooserId === p.id) {
      this.color = color;
      this.phase = 'play';
      this.pending = null;
      this.addLog([{ player: p.name }, ' chose ', { color }, '.']);
      this.advance(1);
      return null;
    }
    return 'You cannot choose a colour now';
  }

  // ---------- per-player view (hides other hands) ----------

  view(forId) {
    const me = this.byId(forId);
    const top = this.topEntry();
    const myTurn = me && this.isTurn(me);
    let pending = null;
    if (this.pending) {
      const { card, opts, ...rest } = this.pending;
      pending = { ...rest, phase: this.phase };
    }
    let playable = [];
    if (myTurn) {
      playable = this.drawnCardId != null
        ? [this.drawnCardId]
        : me.hand.filter((c) => this.canPlayFace(this.face(c))).map((c) => c.id);
    }
    return {
      variantId: this.variant.id,
      variantName: this.variant.name,
      rules: this.rules,
      side: this.side,
      palette: this.palette(),
      color: this.color,
      direction: this.direction,
      turnId: this.players[this.turn].id,
      actorId: this.currentActorId(),
      phase: this.phase,
      pendingDraw: this.pendingDraw,
      top: { face: this.topFace(), claimed: !!top.claim },
      recent: this.discard.slice(-4).map((e) => ({ id: e.card.id, face: e.claim || this.face(e.card), claimed: !!e.claim })),
      drawCount: this.drawPile.length,
      drawTopBack: this.rules.flip && this.drawPile.length ? this.backFace(this.drawPile[this.drawPile.length - 1]) : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        count: p.hand.length,
        out: p.out,
        saidUno: p.saidUno,
        backs: this.rules.flip && p !== me ? p.hand.map((c) => this.backFace(c)) : null,
      })),
      me: me ? {
        id: me.id,
        hand: me.hand.map((c) => ({ id: c.id, face: this.face(c) })),
        playable,
        drawnCardId: myTurn ? this.drawnCardId : null,
        legalClaims: myTurn && this.rules.liar ? this.legalClaims() : null,
      } : null,
      pending,
      unoVulnerable: this.unoVulnerable,
      winnerId: this.winnerId,
      lastReveal: this.lastReveal,
      log: this.log.slice(-40),
    };
  }
}

module.exports = { Game };
