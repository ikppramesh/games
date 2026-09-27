'use strict';
// Small helpers for building decks. A deck is an array of "face sets":
//   [face]          -> a normal one-sided card
//   [light, dark]   -> an UNO Flip double-sided card

const { PALETTES } = require('../engine/cards');

const LIGHT = PALETTES[0];
const DARK = PALETTES[1];

function repeat(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i));
  return out;
}

// `copies` of every number from..to in every colour of `palette`.
function numbers(palette, from, to, copies) {
  const out = [];
  for (const color of palette) {
    for (let v = from; v <= to; v++) out.push(...repeat(copies, () => ({ color, type: 'number', value: v })));
  }
  return out;
}

// `perColor` copies of a coloured action card in every colour of `palette`.
function actions(palette, perColor, face) {
  const out = [];
  for (const color of palette) out.push(...repeat(perColor, () => ({ color, ...face })));
  return out;
}

function wilds(count, face) {
  return repeat(count, () => ({ color: 'wild', ...face }));
}

const single = (faces) => faces.map((f) => [f]);

// The standard 108-card deck, as plain faces.
function classicFaces() {
  return [
    ...numbers(LIGHT, 0, 0, 1),
    ...numbers(LIGHT, 1, 9, 2),
    ...actions(LIGHT, 2, { type: 'skip' }),
    ...actions(LIGHT, 2, { type: 'reverse' }),
    ...actions(LIGHT, 2, { type: 'draw', draw: 2 }),
    ...wilds(4, { type: 'wild' }),
    ...wilds(4, { type: 'wildDraw', draw: 4 }),
  ];
}

module.exports = { LIGHT, DARK, repeat, numbers, actions, wilds, single, classicFaces };
