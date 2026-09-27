'use strict';
// Registry of game modes. To add a new mode: create a file like megadraw.js and add it here.
const { LIGHT, repeat } = require('./deck');

const ALL = [
  require('./classic'),
  require('./flip'),
  require('./nomercy'),
  require('./liars'),
  require('./megadraw'),
];

const byId = new Map(ALL.map((v) => [v.id, v]));

function get(id) {
  return byId.get(id) || byId.get('classic');
}

function list() {
  return ALL.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    rules: v.rules,
    allowsCustomCards: !v.rules.flip,
  }));
}

// Extra cards a host can add from the lobby ("house cards").
const CUSTOM_KINDS = {
  wildDraw: { perColor: false, needsDraw: true, face: (d) => ({ color: 'wild', type: 'wildDraw', draw: d }) },
  draw: { perColor: true, needsDraw: true, face: (d, color) => ({ color, type: 'draw', draw: d }) },
  wildReverseDraw: { perColor: false, needsDraw: true, face: (d) => ({ color: 'wild', type: 'wildReverseDraw', draw: d }) },
  skipAll: { perColor: true, face: (d, color) => ({ color, type: 'skipAll' }) },
  discardAll: { perColor: true, face: (d, color) => ({ color, type: 'discardAll' }) },
  colorRoulette: { perColor: false, face: () => ({ color: 'wild', type: 'colorRoulette' }) },
};

function clampInt(v, min, max, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function sanitizeCustomCards(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).flatMap((c) => {
    const kind = CUSTOM_KINDS[c && c.kind];
    if (!kind) return [];
    const out = { kind: c.kind, count: clampInt(c.count, 1, 20, 1) };
    if (kind.needsDraw) out.draw = clampInt(c.draw, 1, 99, 4);
    return [out];
  });
}

// Custom card spec -> face sets for the deck.
function buildCustomCards(list) {
  const out = [];
  for (const c of list) {
    const kind = CUSTOM_KINDS[c.kind];
    if (!kind) continue;
    if (kind.perColor) {
      for (const color of LIGHT) out.push(...repeat(c.count, () => [kind.face(c.draw, color)]));
    } else {
      out.push(...repeat(c.count, () => [kind.face(c.draw)]));
    }
  }
  return out;
}

function sanitizeRules(r, variant) {
  const base = variant.rules;
  r = r || {};
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  let mercy = clampInt(r.mercyLimit, 0, 200, base.mercyLimit);
  if (mercy > 0 && mercy < 5) mercy = 5;
  return {
    handSize: clampInt(r.handSize, 1, 20, base.handSize),
    stacking: bool(r.stacking, base.stacking),
    drawUntilPlayable: bool(r.drawUntilPlayable, base.drawUntilPlayable),
    sevenZero: bool(r.sevenZero, base.sevenZero),
    mercyLimit: mercy,
    liar: base.flip ? false : bool(r.liar, base.liar),
    flip: base.flip,
  };
}

module.exports = { get, list, sanitizeRules, sanitizeCustomCards, buildCustomCards };
