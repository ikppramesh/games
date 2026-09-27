'use strict';
// Rules self-test: counts all legal move sequences to a fixed depth and
// compares with the published perft numbers (chessprogramming.org).
// Run: node tests/perft.js
const E = require('../engine.js');
const cases = [
  ['startpos', E.START_FEN, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['pos3 (en passant/pins)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['pos4 (promotions/castling)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
let fail = 0;
for (const [name, fen, expected] of cases) {
  const pos = new E.Position(fen);
  expected.forEach((want, i) => {
    const got = E.perft(pos, i + 1);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} depth ${i + 1}: ${got}${ok ? '' : ' (expected ' + want + ')'}`);
  });
}
// the computer finds mate in one
const mateFen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
const mv = E.bestMove(mateFen, 'medium');
const mateOk = E.sqName(mv.from) === 'a1' && E.sqName(mv.to) === 'a8';
if (!mateOk) fail++;
console.log(`${mateOk ? 'ok  ' : 'FAIL'} AI finds back-rank mate: ${E.sqName(mv.from)}${E.sqName(mv.to)}`);
// SAN + game status
const g = new E.Game();
for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) g.play({ from: E.sqIndex(f), to: E.sqIndex(t) });
const st = g.status();
const sanOk = g.history.map(h => h.san).join(' ') === 'f3 e5 g4 Qh4#' && st.reason === 'checkmate' && st.result === '0-1';
if (!sanOk) fail++;
console.log(`${sanOk ? 'ok  ' : 'FAIL'} fool's mate SAN + status: ${g.history.map(h => h.san).join(' ')} ${st.reason} ${st.result}`);
if (fail) { console.error(`${fail} failure(s)`); process.exit(1); }
console.log('All chess tests passed.');
