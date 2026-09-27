/* Chess rules + computer opponent. No DOM code: runs in the page, in the
   AI web worker (ai-worker.js) and in Node (for the perft tests).

   Board: 64 squares, index = rank * 8 + file (a1 = 0, h8 = 63).
   Pieces use FEN letters: uppercase = white, lowercase = black. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChessEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FLAG = { NORMAL: 0, DOUBLE: 1, EP: 2, CASTLE_K: 3, CASTLE_Q: 4 };
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  // castling rights bits
  const WK = 1, WQ = 2, BK = 4, BQ = 8;

  const isWhite = (p) => p && p === p.toUpperCase();
  const colorOf = (p) => (p ? (isWhite(p) ? 'w' : 'b') : null);
  const fileOf = (sq) => sq & 7, rankOf = (sq) => sq >> 3;
  const sqName = (sq) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
  const sqIndex = (name) => (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);

  class Position {
    constructor(fen) { this.load(fen || START_FEN); }

    load(fen) {
      const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
      this.board = new Array(64).fill(null);
      const rows = placement.split('/');
      for (let r = 0; r < 8; r++) {
        let f = 0;
        for (const ch of rows[r]) {
          if (/\d/.test(ch)) f += +ch;
          else { this.board[(7 - r) * 8 + f] = ch; f++; }
        }
      }
      this.turn = turn || 'w';
      this.castling = 0;
      if (castling && castling !== '-') {
        if (castling.includes('K')) this.castling |= WK;
        if (castling.includes('Q')) this.castling |= WQ;
        if (castling.includes('k')) this.castling |= BK;
        if (castling.includes('q')) this.castling |= BQ;
      }
      this.ep = ep && ep !== '-' ? sqIndex(ep) : -1;
      this.half = +(half || 0);
      this.full = +(full || 1);
      this.kings = { w: this.board.indexOf('K'), b: this.board.indexOf('k') };
    }

    fen() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 8 + f];
          if (!p) { empty++; continue; }
          if (empty) { s += empty; empty = 0; }
          s += p;
        }
        if (empty) s += empty;
        if (r) s += '/';
      }
      let c = '';
      if (this.castling & WK) c += 'K';
      if (this.castling & WQ) c += 'Q';
      if (this.castling & BK) c += 'k';
      if (this.castling & BQ) c += 'q';
      return `${s} ${this.turn} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
    }

    // position part only: used for threefold repetition
    key() { return this.fen().split(' ').slice(0, 4).join(' '); }

    clone() { const p = new Position(this.fen()); return p; }

    // is square `sq` attacked by side `by` ('w'|'b')?
    attacked(sq, by) {
      const b = this.board, f = fileOf(sq), r = rankOf(sq);
      const up = by === 'w' ? -1 : 1; // attacking pawns sit one rank "behind" the square
      const pawn = by === 'w' ? 'P' : 'p';
      for (const df of [-1, 1]) {
        const ff = f + df, rr = r + up;
        if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 && b[rr * 8 + ff] === pawn) return true;
      }
      const N = by === 'w' ? 'N' : 'n', K = by === 'w' ? 'K' : 'k';
      for (const [df, dr] of KNIGHT) {
        const ff = f + df, rr = r + dr;
        if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 && b[rr * 8 + ff] === N) return true;
      }
      for (const [df, dr] of KING) {
        const ff = f + df, rr = r + dr;
        if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 && b[rr * 8 + ff] === K) return true;
      }
      const R = by === 'w' ? 'R' : 'r', B = by === 'w' ? 'B' : 'b', Q = by === 'w' ? 'Q' : 'q';
      for (const [dirs, a, c] of [[ROOK_DIRS, R, Q], [BISHOP_DIRS, B, Q]]) {
        for (const [df, dr] of dirs) {
          let ff = f + df, rr = r + dr;
          while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
            const p = b[rr * 8 + ff];
            if (p) { if (p === a || p === c) return true; break; }
            ff += df; rr += dr;
          }
        }
      }
      return false;
    }

    inCheck(side) {
      side = side || this.turn;
      return this.attacked(this.kings[side], side === 'w' ? 'b' : 'w');
    }

    pseudoMoves(capturesOnly) {
      const moves = [], b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
      const add = (from, to, flag, promo) => {
        const m = { from, to, piece: b[from], captured: flag === FLAG.EP ? (us === 'w' ? 'p' : 'P') : b[to], flag: flag || 0 };
        if (promo) m.promo = promo;
        moves.push(m);
      };
      for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (!p || colorOf(p) !== us) continue;
        const f = fileOf(sq), r = rankOf(sq), type = p.toUpperCase();
        if (type === 'P') {
          const dir = us === 'w' ? 1 : -1, startRank = us === 'w' ? 1 : 6, lastRank = us === 'w' ? 7 : 0;
          const promos = us === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
          const one = sq + dir * 8;
          if (!capturesOnly && one >= 0 && one < 64 && !b[one]) {
            if (rankOf(one) === lastRank) promos.forEach(pr => add(sq, one, 0, pr));
            else {
              add(sq, one);
              const two = one + dir * 8;
              if (r === startRank && !b[two]) add(sq, two, FLAG.DOUBLE);
            }
          }
          for (const df of [-1, 1]) {
            const ff = f + df;
            if (ff < 0 || ff > 7) continue;
            const to = (r + dir) * 8 + ff;
            if (to < 0 || to > 63) continue;
            if (b[to] && colorOf(b[to]) === them) {
              if (rankOf(to) === lastRank) promos.forEach(pr => add(sq, to, 0, pr));
              else add(sq, to);
            } else if (to === this.ep) add(sq, to, FLAG.EP);
          }
        } else if (type === 'N' || type === 'K') {
          for (const [df, dr] of type === 'N' ? KNIGHT : KING) {
            const ff = f + df, rr = r + dr;
            if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue;
            const to = rr * 8 + ff, t = b[to];
            if (t && colorOf(t) === us) continue;
            if (capturesOnly && !t) continue;
            add(sq, to);
          }
          if (type === 'K' && !capturesOnly) this._castles(sq, add);
        } else {
          const dirs = type === 'R' ? ROOK_DIRS : type === 'B' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
          for (const [df, dr] of dirs) {
            let ff = f + df, rr = r + dr;
            while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
              const to = rr * 8 + ff, t = b[to];
              if (t) { if (colorOf(t) === them) add(sq, to); break; }
              if (!capturesOnly) add(sq, to);
              ff += df; rr += dr;
            }
          }
        }
      }
      return moves;
    }

    _castles(sq, add) {
      const b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
      const home = us === 'w' ? 4 : 60;
      if (sq !== home || this.attacked(home, them)) return;
      const [kBit, qBit] = us === 'w' ? [WK, WQ] : [BK, BQ];
      const rook = us === 'w' ? 'R' : 'r';
      if ((this.castling & kBit) && !b[home + 1] && !b[home + 2] && b[home + 3] === rook &&
        !this.attacked(home + 1, them) && !this.attacked(home + 2, them)) add(home, home + 2, FLAG.CASTLE_K);
      if ((this.castling & qBit) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook &&
        !this.attacked(home - 1, them) && !this.attacked(home - 2, them)) add(home, home - 2, FLAG.CASTLE_Q);
    }

    // applies a move; returns the info needed to undo it
    make(m) {
      const b = this.board, us = this.turn;
      const undo = { castling: this.castling, ep: this.ep, half: this.half, full: this.full, kings: { ...this.kings } };
      b[m.to] = m.promo || m.piece;
      b[m.from] = null;
      if (m.flag === FLAG.EP) b[m.to + (us === 'w' ? -8 : 8)] = null;
      else if (m.flag === FLAG.CASTLE_K) { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
      else if (m.flag === FLAG.CASTLE_Q) { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
      if (m.piece === 'K' || m.piece === 'k') this.kings[us] = m.to;
      // castling rights: king/rook moved or rook captured
      for (const s of [m.from, m.to]) {
        if (s === 4) this.castling &= ~(WK | WQ);
        else if (s === 60) this.castling &= ~(BK | BQ);
        else if (s === 0) this.castling &= ~WQ;
        else if (s === 7) this.castling &= ~WK;
        else if (s === 56) this.castling &= ~BQ;
        else if (s === 63) this.castling &= ~BK;
      }
      this.ep = m.flag === FLAG.DOUBLE ? (m.from + m.to) >> 1 : -1;
      this.half = m.piece.toUpperCase() === 'P' || m.captured ? 0 : this.half + 1;
      if (us === 'b') this.full++;
      this.turn = us === 'w' ? 'b' : 'w';
      return undo;
    }

    unmake(m, undo) {
      const b = this.board;
      this.turn = this.turn === 'w' ? 'b' : 'w';
      const us = this.turn;
      b[m.from] = m.piece;
      b[m.to] = m.flag === FLAG.EP ? null : m.captured || null;
      if (m.flag === FLAG.EP) b[m.to + (us === 'w' ? -8 : 8)] = m.captured;
      else if (m.flag === FLAG.CASTLE_K) { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
      else if (m.flag === FLAG.CASTLE_Q) { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
      this.castling = undo.castling; this.ep = undo.ep; this.half = undo.half; this.full = undo.full; this.kings = undo.kings;
    }

    legalMoves() {
      const us = this.turn, out = [];
      for (const m of this.pseudoMoves()) {
        const u = this.make(m);
        if (!this.attacked(this.kings[us], this.turn)) out.push(m);
        this.unmake(m, u);
      }
      return out;
    }

    insufficientMaterial() {
      const pieces = this.board.map((p, i) => [p, i]).filter(([p]) => p && p.toUpperCase() !== 'K');
      if (!pieces.length) return true;
      if (pieces.length === 1 && 'NBnb'.includes(pieces[0][0])) return true;
      // only bishops, all on the same colour squares
      if (pieces.every(([p]) => p === 'B' || p === 'b')) {
        const shade = (i) => (fileOf(i) + rankOf(i)) & 1;
        return pieces.every(([, i]) => shade(i) === shade(pieces[0][1]));
      }
      return false;
    }

    // standard algebraic notation for a legal move in this position
    san(m, legal) {
      legal = legal || this.legalMoves();
      let s;
      if (m.flag === FLAG.CASTLE_K) s = 'O-O';
      else if (m.flag === FLAG.CASTLE_Q) s = 'O-O-O';
      else {
        const type = m.piece.toUpperCase();
        const cap = !!m.captured;
        if (type === 'P') s = (cap ? 'abcdefgh'[fileOf(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
        else {
          const rivals = legal.filter(o => o.piece === m.piece && o.to === m.to && o.from !== m.from);
          let dis = '';
          if (rivals.length) {
            if (rivals.every(o => fileOf(o.from) !== fileOf(m.from))) dis = 'abcdefgh'[fileOf(m.from)];
            else if (rivals.every(o => rankOf(o.from) !== rankOf(m.from))) dis = String(rankOf(m.from) + 1);
            else dis = sqName(m.from);
          }
          s = type + dis + (cap ? 'x' : '') + sqName(m.to);
        }
      }
      const u = this.make(m);
      if (this.inCheck()) s += this.legalMoves().length ? '+' : '#';
      this.unmake(m, u);
      return s;
    }
  }

  // ---------- game wrapper: history, status, undo ----------
  class Game {
    constructor(fen) {
      this.pos = new Position(fen);
      this.history = []; // {move, undo, san, key}
      this.keys = [this.pos.key()];
    }
    turn() { return this.pos.turn; }
    board() { return this.pos.board; }
    moves() { return this.pos.legalMoves(); }
    movesFrom(sq) { return this.moves().filter(m => m.from === sq); }
    find(from, to, promo) {
      return this.moves().find(m => m.from === from && m.to === to && (!m.promo || m.promo.toUpperCase() === (promo || 'Q').toUpperCase()));
    }
    play(m) {
      const legal = this.moves();
      const real = legal.find(o => o.from === m.from && o.to === m.to && (o.promo || null) === (m.promo || null));
      if (!real) return null;
      const san = this.pos.san(real, legal);
      const undo = this.pos.make(real);
      this.history.push({ move: real, undo, san });
      this.keys.push(this.pos.key());
      return { move: real, san };
    }
    undo() {
      const h = this.history.pop();
      if (!h) return null;
      this.pos.unmake(h.move, h.undo);
      this.keys.pop();
      return h;
    }
    lastMove() { const h = this.history[this.history.length - 1]; return h ? h.move : null; }
    // {over, result: '1-0'|'0-1'|'1/2-1/2', reason}
    status() {
      const legal = this.moves();
      const check = this.pos.inCheck();
      if (!legal.length) {
        if (check) return { over: true, check, result: this.pos.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
        return { over: true, check, result: '1/2-1/2', reason: 'stalemate' };
      }
      if (this.pos.half >= 100) return { over: true, check, result: '1/2-1/2', reason: '50-move rule' };
      const k = this.keys[this.keys.length - 1];
      if (this.keys.filter(x => x === k).length >= 3) return { over: true, check, result: '1/2-1/2', reason: 'threefold repetition' };
      if (this.pos.insufficientMaterial()) return { over: true, check, result: '1/2-1/2', reason: 'insufficient material' };
      return { over: false, check };
    }
  }

  // ---------- perft (rules self-test) ----------
  function perft(pos, depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of pos.legalMoves()) {
      const u = pos.make(m);
      n += perft(pos, depth - 1);
      pos.unmake(m, u);
    }
    return n;
  }

  // ---------- computer opponent ----------
  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  // piece-square tables (white's view, a8..h1 reading order), from the
  // "simplified evaluation function"
  const PST = {
    P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    KE: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50]
  };
  const pstIndex = (sq, white) => (white ? (7 - rankOf(sq)) * 8 + fileOf(sq) : rankOf(sq) * 8 + fileOf(sq));

  function evaluate(pos) {
    const b = pos.board;
    let score = 0, nonPawn = 0;
    for (let sq = 0; sq < 64; sq++) { const p = b[sq]; if (p && !'PpKk'.includes(p)) nonPawn += VALUE[p.toUpperCase()]; }
    const endgame = nonPawn <= 1300;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      const white = isWhite(p), t = p.toUpperCase();
      const table = t === 'K' && endgame ? PST.KE : PST[t];
      const v = VALUE[t] + table[pstIndex(sq, white)];
      score += white ? v : -v;
    }
    return pos.turn === 'w' ? score : -score;
  }

  const MATE = 100000;
  function orderMoves(moves) {
    for (const m of moves) {
      m._o = (m.captured ? 10 * VALUE[m.captured.toUpperCase()] - VALUE[m.piece.toUpperCase()] / 10 + 1000 : 0) + (m.promo ? 800 : 0);
    }
    return moves.sort((a, b) => b._o - a._o);
  }

  function search(pos, level, timeMs) {
    const deadline = Date.now() + timeMs;
    let nodes = 0, stop = false;

    function quiesce(alpha, beta, qd) {
      if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true;
      const stand = evaluate(pos);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (qd > 6) return alpha;
      const us = pos.turn;
      for (const m of orderMoves(pos.pseudoMoves(true))) {
        const u = pos.make(m);
        if (pos.attacked(pos.kings[us], pos.turn)) { pos.unmake(m, u); continue; }
        const s = -quiesce(-beta, -alpha, qd + 1);
        pos.unmake(m, u);
        if (stop) return alpha;
        if (s >= beta) return beta;
        if (s > alpha) alpha = s;
      }
      return alpha;
    }

    function negamax(depth, alpha, beta, ply) {
      if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true;
      if (depth === 0) return quiesce(alpha, beta, 0);
      const us = pos.turn;
      let any = false;
      for (const m of orderMoves(pos.pseudoMoves())) {
        const u = pos.make(m);
        if (pos.attacked(pos.kings[us], pos.turn)) { pos.unmake(m, u); continue; }
        any = true;
        const s = -negamax(depth - 1, -beta, -alpha, ply + 1);
        pos.unmake(m, u);
        if (stop) return alpha;
        if (s >= beta) return beta;
        if (s > alpha) alpha = s;
      }
      if (!any) return pos.inCheck() ? -MATE + ply : 0;
      return alpha;
    }

    const root = orderMoves(pos.legalMoves());
    if (!root.length) return null;
    let best = root[0], bestScores = root.map(m => ({ m, s: 0 }));
    const maxDepth = { easy: 1, medium: 3, hard: 6 }[level] || 3;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const scored = [];
      let alpha = -Infinity;
      for (const m of root) {
        const u = pos.make(m);
        const s = -negamax(depth - 1, -MATE - 1, level === 'easy' ? MATE + 1 : -alpha, 1);
        pos.unmake(m, u);
        if (stop) break;
        scored.push({ m, s });
        if (s > alpha) alpha = s;
      }
      if (stop && depth > 1) break;
      scored.sort((a, b) => b.s - a.s);
      bestScores = scored;
      best = scored[0].m;
      // search the previous best first next time round
      root.sort((a, b) => (a === best ? -1 : b === best ? 1 : 0));
      if (Math.abs(scored[0].s) > MATE - 100) break;
    }
    // easy: often pick a decent-but-not-best move so it's beatable
    if (level === 'easy' && bestScores.length > 1 && Math.random() < 0.55) {
      const pool = bestScores.slice(0, Math.min(5, bestScores.length)).filter(x => x.s > bestScores[0].s - 250);
      best = pool[Math.floor(Math.random() * pool.length)].m;
    }
    return { from: best.from, to: best.to, promo: best.promo || null, nodes };
  }

  function bestMove(fen, level) {
    const pos = new Position(fen);
    const time = { easy: 300, medium: 900, hard: 2200 }[level] || 900;
    return search(pos, level, time);
  }

  return { Position, Game, FLAG, START_FEN, perft, bestMove, sqName, sqIndex, colorOf, fileOf, rankOf, evaluate };
});
