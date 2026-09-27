'use strict';

// Colour palettes. Side 0 is the normal/"light" side, side 1 is the UNO Flip "dark" side.
// Themes only change how these keys look; the engine only ever deals with the keys.
const PALETTES = [
  ['red', 'yellow', 'green', 'blue'],
  ['pink', 'teal', 'orange', 'purple'],
];

// Card face types understood by the engine:
//   number          { color, type, value }
//   skip / reverse  { color, type }
//   draw            { color, type, draw }        coloured "+N"
//   skipAll         { color, type }              skip everyone (you play again)
//   discardAll      { color, type }              discard every card of this colour
//   flip            { color, type }              UNO Flip: flip the whole deck
//   wild            { color:'wild', type }
//   wildDraw        { color:'wild', type, draw } wild "+N"
//   wildReverseDraw { color:'wild', type, draw } reverse, then next player draws N
//   colorRoulette   { color:'wild', type }       next player picks a colour and draws until they hit it
//   wildDrawColor   { color:'wild', type }       next player draws until they hit the chosen colour
const DRAW_TYPES = new Set(['draw', 'wildDraw', 'wildReverseDraw']);

function faceKey(f) {
  switch (f.type) {
    case 'number': return 'n' + f.value;
    case 'draw': return 'd' + f.draw;
    case 'wildDraw': return 'wd' + f.draw;
    case 'wildReverseDraw': return 'wrd' + f.draw;
    default: return f.type;
  }
}

const isWild = (f) => f.color === 'wild';
const isDrawFace = (f) => DRAW_TYPES.has(f.type);
const needsColorChoice = (f) => isWild(f) && f.type !== 'colorRoulette';
const sameFace = (a, b) => !!a && !!b && faceKey(a) === faceKey(b) && a.color === b.color;

// Can `face` be played on `top` given the active colour and any pending stacked draw?
function canPlay(face, top, color, pendingDraw) {
  if (pendingDraw > 0) return isDrawFace(face) && face.draw >= (top.draw || 0);
  if (isWild(face)) return true;
  if (face.color === color) return true;
  return faceKey(face) === faceKey(top);
}

function cleanFace(f) {
  const out = { color: f.color, type: f.type };
  if (f.type === 'number') out.value = f.value;
  if (f.draw) out.draw = f.draw;
  return out;
}

module.exports = { PALETTES, faceKey, isWild, isDrawFace, needsColorChoice, sameFace, canPlay, cleanFace };
