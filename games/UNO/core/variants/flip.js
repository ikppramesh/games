'use strict';
const { LIGHT, DARK, numbers, actions, wilds } = require('./deck');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 112 double-sided cards. The light and dark sides are paired randomly, like a real deck.
function buildDeck() {
  const light = [
    ...numbers(LIGHT, 1, 9, 2),
    ...actions(LIGHT, 2, { type: 'draw', draw: 1 }),
    ...actions(LIGHT, 2, { type: 'reverse' }),
    ...actions(LIGHT, 2, { type: 'skip' }),
    ...actions(LIGHT, 2, { type: 'flip' }),
    ...wilds(4, { type: 'wild' }),
    ...wilds(4, { type: 'wildDraw', draw: 2 }),
  ];
  const dark = shuffle([
    ...numbers(DARK, 1, 9, 2),
    ...actions(DARK, 2, { type: 'draw', draw: 5 }),
    ...actions(DARK, 2, { type: 'reverse' }),
    ...actions(DARK, 2, { type: 'skipAll' }),
    ...actions(DARK, 2, { type: 'flip' }),
    ...wilds(4, { type: 'wild' }),
    ...wilds(4, { type: 'wildDrawColor' }),
  ]);
  return light.map((f, i) => [f, dark[i]]);
}

module.exports = {
  id: 'flip',
  name: 'UNO Flip',
  description: 'Double-sided cards. Play a Flip card to turn everything to the brutal Dark side: Draw 5, Skip Everyone and Wild Draw Colour.',
  rules: { handSize: 7, stacking: false, drawUntilPlayable: false, sevenZero: false, mercyLimit: 0, liar: false, flip: true },
  buildDeck,
};
