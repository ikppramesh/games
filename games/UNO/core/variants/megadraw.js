'use strict';
// Example of a home-made variant: use this file as a template for your own designs.
// Copy it, change id/name/rules/buildDeck, and register it in ./index.js.
const { LIGHT, single, classicFaces, actions, wilds } = require('./deck');

module.exports = {
  id: 'megadraw',
  name: 'Mega Draw (+15)',
  description: 'A custom design: the classic deck plus Draw 6 cards and brutal Wild Draw 15 cards. Draw cards stack! Hit 40 cards and you are out.',
  rules: { handSize: 7, stacking: true, drawUntilPlayable: false, sevenZero: false, mercyLimit: 40, liar: false, flip: false },
  buildDeck: () => single([
    ...classicFaces(),
    ...actions(LIGHT, 1, { type: 'draw', draw: 6 }),
    ...wilds(4, { type: 'wildDraw', draw: 15 }),
  ]),
};
