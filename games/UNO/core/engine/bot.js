'use strict';
const C = require('./cards');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function bestColor(game, p, exceptCardId) {
  const palette = game.palette();
  const counts = Object.fromEntries(palette.map((c) => [c, 0]));
  for (const c of p.hand) {
    if (c.id === exceptCardId) continue;
    const f = game.face(c);
    if (counts[f.color] !== undefined) counts[f.color]++;
  }
  const max = Math.max(...Object.values(counts));
  return pick(palette.filter((c) => counts[c] === max));
}

function weakestOpponent(game, p) {
  const others = game.players.filter((o) => !o.out && o !== p);
  const min = Math.min(...others.map((o) => o.hand.length));
  return pick(others.filter((o) => o.hand.length === min));
}

function scoreFace(game, p, f) {
  const next = game.players[game.nextIndex(game.turn)];
  const threat = next.hand.length <= 2;
  let s;
  switch (f.type) {
    case 'number': s = 10 + f.value * 0.1; break;
    case 'wild': s = 2; break;
    case 'wildDraw': case 'wildReverseDraw': case 'wildDrawColor': case 'colorRoulette': s = threat ? 25 : 3; break;
    case 'discardAll': s = 12 + 3 * p.hand.filter((c) => game.face(c).color === f.color).length; break;
    default: s = threat ? 22 : 12;
  }
  if (game.rules.sevenZero && f.type === 'number' && f.value === 7) {
    const w = weakestOpponent(game, p);
    s += w && w.hand.length < p.hand.length - 1 ? 15 : -8;
  }
  if (!C.isWild(f) && f.color === game.color) s += 1;
  return s + Math.random();
}

function buildPlay(game, p, card, face) {
  const a = { type: 'play', cardId: card.id };
  if (C.needsColorChoice(face)) a.color = bestColor(game, p, card.id);
  if (game.rules.sevenZero && face.type === 'number' && face.value === 7) a.targetId = weakestOpponent(game, p).id;
  return a;
}

function liarTurn(game, p) {
  const honest = p.hand.filter((c) => game.canPlayFace(game.face(c)));
  if (honest.length && Math.random() < 0.88) {
    const best = honest.reduce((a, b) => (scoreFace(game, p, game.face(a)) >= scoreFace(game, p, game.face(b)) ? a : b));
    return { ...buildPlay(game, p, best, game.face(best)), claim: C.cleanFace(game.face(best)) };
  }
  if (Math.random() < 0.55 || p.hand.length > 12) {
    // Bluff: dump a high number card, claim something believable.
    const card = [...p.hand].sort((a, b) => (game.face(b).value || 0) - (game.face(a).value || 0))[0];
    const claims = game.legalClaims();
    const plain = claims.filter((f) => f.type === 'number');
    const claim = plain.length && Math.random() < 0.75 ? pick(plain) : pick(claims);
    const a = { ...buildPlay(game, p, card, claim), claim };
    return a;
  }
  return { type: 'draw' };
}

// Decide the next action for a computer-controlled player (or a disconnected human).
function botAction(game, p) {
  switch (game.phase) {
    case 'liarChallenge': {
      const liar = game.byId(game.pending.liarId);
      let chance = 0.22;
      if (C.isDrawFace(game.pending.claim) || game.pending.claim.type === 'skip') chance += 0.18;
      if (liar.hand.length <= 1) chance += 0.25;
      // If I hold the exact card they claim, it's a bit less likely they have it.
      if (p.hand.some((c) => C.sameFace(game.face(c), game.pending.claim))) chance += 0.1;
      return { type: 'challenge', call: Math.random() < chance };
    }
    case 'roulette':
    case 'chooseColor':
      return { type: 'chooseColor', color: bestColor(game, p) };
    case 'play':
      break;
    default:
      return null;
  }

  if (game.drawnCardId != null) {
    const card = p.hand.find((c) => c.id === game.drawnCardId);
    if (card && Math.random() < 0.9) return buildPlay(game, p, card, game.face(card));
    return { type: 'pass' };
  }

  if (game.rules.liar) return liarTurn(game, p);

  const playable = p.hand.filter((c) => game.canPlayFace(game.face(c)));
  if (!playable.length) return { type: 'draw' };

  let best;
  if (game.pendingDraw > 0) {
    // Stack with the smallest draw card, preferring coloured ones.
    best = playable.sort((a, b) => {
      const fa = game.face(a), fb = game.face(b);
      return (fa.draw - fb.draw) || (C.isWild(fa) - C.isWild(fb));
    })[0];
  } else {
    best = playable.reduce((a, b) => (scoreFace(game, p, game.face(a)) >= scoreFace(game, p, game.face(b)) ? a : b));
  }
  return buildPlay(game, p, best, game.face(best));
}

module.exports = { botAction };
