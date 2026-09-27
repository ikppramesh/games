'use strict';
const { LIGHT, numbers, actions, wilds, single } = require('./deck');

// 168 cards.
function buildDeck() {
  return single([
    ...numbers(LIGHT, 0, 9, 2),
    ...actions(LIGHT, 3, { type: 'skip' }),
    ...actions(LIGHT, 2, { type: 'skipAll' }),
    ...actions(LIGHT, 3, { type: 'reverse' }),
    ...actions(LIGHT, 3, { type: 'draw', draw: 2 }),
    ...actions(LIGHT, 2, { type: 'draw', draw: 4 }),
    ...actions(LIGHT, 3, { type: 'discardAll' }),
    ...wilds(8, { type: 'wildReverseDraw', draw: 4 }),
    ...wilds(4, { type: 'wildDraw', draw: 6 }),
    ...wilds(4, { type: 'wildDraw', draw: 10 }),
    ...wilds(8, { type: 'colorRoulette' }),
  ]);
}

module.exports = {
  id: 'nomercy',
  name: 'UNO Show \'em No Mercy',
  description: 'Stack draw cards, draw until you can play, 7 swaps hands, 0 passes hands, Draw 6/10 and Colour Roulette. Reach 25 cards and you are OUT.',
  rules: { handSize: 7, stacking: true, drawUntilPlayable: true, sevenZero: true, mercyLimit: 25, liar: false, flip: false },
  buildDeck,
};
