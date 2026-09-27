'use strict';
const { single, classicFaces } = require('./deck');

module.exports = {
  id: 'classic',
  name: 'Classic UNO',
  description: 'The original: 108 cards, match colour or number, Skip, Reverse, Draw 2, Wild and Wild Draw 4.',
  rules: { handSize: 7, stacking: false, drawUntilPlayable: false, sevenZero: false, mercyLimit: 0, liar: false, flip: false },
  buildDeck: () => single(classicFaces()),
};
