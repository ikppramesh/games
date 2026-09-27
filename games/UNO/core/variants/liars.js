'use strict';
const { single, classicFaces } = require('./deck');

module.exports = {
  id: 'liars',
  name: 'Liar\'s UNO',
  description: 'Cards are played face-down and you announce what they are — true or not! The next player can believe you or call "LIAR!". Caught bluffing: take the card back +2. Wrong accusation: the accuser draws 2.',
  rules: { handSize: 7, stacking: false, drawUntilPlayable: false, sevenZero: false, mercyLimit: 0, liar: true, flip: false },
  buildDeck: () => single(classicFaces()),
};
