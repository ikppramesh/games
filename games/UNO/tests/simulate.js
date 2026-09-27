'use strict';
// Plays thousands of bot-only games in every mode to shake out rule-engine bugs.
// Run: npm test
const assert = require('assert');
const { Game } = require('../core/engine/game');
const { botAction } = require('../core/engine/bot');
const variants = require('../core/variants');

const GAMES_PER_CONFIG = 150;
const MAX_STEPS = 5000;

function totalCards(g) {
  return g.drawPile.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length, 0);
}

function run(variantId, playerCount, extra = {}) {
  const variant = variants.get(variantId);
  const rules = variants.sanitizeRules({ ...variant.rules, ...extra.rules }, variant);
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: 'p' + i, name: 'Bot' + i, isBot: true }));
  const g = new Game({ players, variant, rules, customCards: extra.customCards });
  g.start();
  let cardCount = totalCards(g);
  let steps = 0;
  while (g.phase !== 'over' && steps < MAX_STEPS) {
    const id = g.currentActorId();
    const p = g.byId(id);
    assert(p && !p.out, `actor ${id} must be an active player (${variantId})`);
    if (g.phase === 'play' && p.hand.length === 2 && Math.random() < 0.7) g.act(id, { type: 'uno' });
    const a = botAction(g, p);
    const err = g.act(id, a);
    if (err) throw new Error(`${variantId}: bot action ${JSON.stringify(a)} rejected: ${err}`);
    if (g.phase !== 'over' && g.unoVulnerable && Math.random() < 0.3) {
      const catcher = g.players.find((x) => !x.out && x.id !== g.unoVulnerable);
      if (catcher) assert.strictEqual(g.act(catcher.id, { type: 'catch', targetId: g.unoVulnerable }), null);
    }
    // Every view must serialise cleanly.
    JSON.stringify(g.view(g.players[0].id));
    // Cards are never lost; the total only grows when a fresh deck is opened.
    const now = totalCards(g);
    assert(now >= cardCount, `${variantId}: cards were lost`);
    cardCount = now;
    steps++;
  }
  return { finished: g.phase === 'over', steps };
}

const configs = [
  ['classic', {}],
  ['classic', { rules: { stacking: true, drawUntilPlayable: true, sevenZero: true } }],
  ['flip', {}],
  ['nomercy', {}],
  ['liars', {}],
  ['megadraw', {}],
  ['classic', { rules: { liar: true, stacking: true, mercyLimit: 20 }, customCards: [{ kind: 'wildDraw', draw: 15, count: 3 }, { kind: 'colorRoulette', count: 2 }, { kind: 'discardAll', count: 1 }] }],
];

let failures = 0;
for (const [id, extra] of configs) {
  for (const n of [2, 3, 6, 10]) {
    let unfinished = 0;
    let steps = 0;
    for (let i = 0; i < GAMES_PER_CONFIG; i++) {
      try {
        const r = run(id, n, extra);
        if (!r.finished) unfinished++;
        steps += r.steps;
      } catch (e) {
        failures++;
        console.error('FAIL', id, n, e.stack);
        break;
      }
    }
    console.log(`${id.padEnd(9)} ${JSON.stringify(extra.rules || {}).slice(0, 40).padEnd(40)} players=${String(n).padEnd(2)} avg steps=${Math.round(steps / GAMES_PER_CONFIG)} unfinished=${unfinished}`);
  }
}
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('All simulations passed.');
