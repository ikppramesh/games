/* Tic Tac Toe with themes. Modes: vs computer (minimax; easy/medium make
   mistakes on purpose), pass & play, and online 1-on-1 over PeerJS where the
   host is the authority. Pieces are emoji + colour, no character images. */
(function () {
  'use strict';
  const THEMES = {
    classic: {
      name: 'Classic', icon: '❌', title: 'Tic Tac Toe',
      bg: ['#1c2b3a', '#0b1016'], board: '#15212d', line: '#4fd1c5', accent: '#4fd1c5', accentText: '#062420', text: '#eef4f8', muted: '#9fb3c4',
      x: { em: 'X', name: 'X', color: '#ff6b6b', letter: true }, o: { em: 'O', name: 'O', color: '#4fd1c5', letter: true },
      pattern: null, confetti: ['✨', '⭐', '🎉'], win: 'wins!'
    },
    barbie: {
      name: 'Barbie', icon: '🎀', title: 'Dream Tic Tac Toe',
      bg: ['#3a0f2c', '#16040f'], board: '#6e2a55', line: '#ffb3d9', accent: '#ff5fa8', accentText: '#fff', text: '#fff5fb', muted: '#f3c2dd',
      x: { em: '💖', name: 'Heart', color: '#ff5fa8' }, o: { em: '👑', name: 'Crown', color: '#ffd23f' },
      pattern: 'hearts', confetti: ['💖', '✨', '🎀', '💅'], win: 'is the Dream Champion!'
    },
    batman: {
      name: 'Batman', icon: '🦇', title: 'Gotham Tic Tac Toe',
      bg: ['#1b1d24', '#050608'], board: '#1f2229', line: '#f6c93b', accent: '#f6c93b', accentText: '#141208', text: '#eef0f4', muted: '#a9adb8',
      x: { em: '🦇', name: 'Bat', color: '#f6c93b' }, o: { em: '🃏', name: 'Joker', color: '#a78bfa' },
      pattern: 'bats', confetti: ['🦇', '⚡', '💥'], win: 'saves Gotham!'
    },
    spider: {
      name: 'Spider-Man', icon: '🕷️', title: 'Web Tic Tac Toe',
      bg: ['#16204a', '#060a1c'], board: '#1f3170', line: '#e8323f', accent: '#e8323f', accentText: '#fff', text: '#f4f6ff', muted: '#b7c2ec',
      x: { em: '🕷️', name: 'Spidey', color: '#ff5a64' }, o: { em: '🐞', name: 'Bug', color: '#ff8a3d' },
      pattern: 'web', confetti: ['🕸️', '💥', '⭐'], win: 'swings to victory!'
    },
    ramayan: {
      name: 'Ramayan', icon: '🏹', title: 'Ramayan Tic Tac Toe',
      bg: ['#3a1a06', '#140801'], board: '#7a3e0c', line: '#ffd27a', accent: '#ff9f1c', accentText: '#2a1300', text: '#fff6e5', muted: '#f2cf9a',
      x: { em: '🏹', name: 'Ram', color: '#ffd27a' }, o: { em: '🐒', name: 'Hanuman', color: '#ff9f1c' },
      pattern: 'lotus', confetti: ['🪔', '🌺', '✨'], win: 'wins — Jai Shri Ram!'
    }
  };
  const ORDER = ['classic', 'barbie', 'batman', 'spider', 'ramayan'];
  const PATTERNS = {
    hearts: '<text x="20" y="27" font-size="16" text-anchor="middle" fill="rgba(255,255,255,0.06)">♥</text>',
    bats: '<path d="M20 16c-2-4-7-5-10-2 3 0 5 2 5 4-3-1-6 0-7 3 3-1 6 0 8 2 1-1 3-2 4-2s3 1 4 2c2-2 5-3 8-2-1-3-4-4-7-3 0-2 2-4 5-4-3-3-8-2-10 2z" fill="rgba(255,255,255,0.05)"/>',
    web: '<g stroke="rgba(255,255,255,0.07)" stroke-width="0.8" fill="none"><path d="M0 0L40 40M40 0L0 40M20 0V40M0 20H40"/><circle cx="20" cy="20" r="7"/><circle cx="20" cy="20" r="14"/></g>',
    lotus: '<path d="M20 30c-6-3-8-9-6-14 3 3 5 6 6 10 1-4 3-7 6-10 2 5 0 11-6 14z" fill="rgba(255,255,255,0.06)"/>'
  };
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ttt.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ttt.' + k, v); } catch (e) { /* ignore */ } }
  };

  let themeId = THEMES[store.get('theme')] ? store.get('theme') : 'classic';
  let T = THEMES[themeId];
  let mode = null;            // 'cpu' | 'pass' | 'host' | 'client'
  let level = 'medium';
  let board = Array(9).fill(null);
  let turn = 'x', starter = 'x', result = null; // result: {winner:'x'|'o'|null, line}
  let mySide = 'x';
  let names = { x: 'Player 1', o: 'Player 2' };
  let wins = { x: 0, o: 0, d: 0 };
  let cpuTimer = null;

  // ---------- theme ----------
  function applyTheme() {
    const s = document.documentElement.style;
    s.setProperty('--bg1', T.bg[0]); s.setProperty('--bg2', T.bg[1]);
    s.setProperty('--board', T.board); s.setProperty('--line', T.line);
    s.setProperty('--accent', T.accent); s.setProperty('--accent-text', T.accentText);
    s.setProperty('--text', T.text); s.setProperty('--muted', T.muted);
    s.setProperty('--cx', T.x.color); s.setProperty('--co', T.o.color);
    s.setProperty('--pattern', T.pattern ? `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>${PATTERNS[T.pattern]}</svg>`)}")` : 'none');
    $('themeIcon').textContent = T.icon;
    $('themeTitle').textContent = T.title;
    document.title = T.title;
    $('markX').innerHTML = markHtml('x');
    $('markO').innerHTML = markHtml('o');
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === themeId);
      b.disabled = mode === 'client'; // online: the host picks
    });
    render();
  }
  function markHtml(side) {
    const p = T[side];
    return p.letter ? `<span style="color:${p.color};font-weight:800">${p.em}</span>` : p.em;
  }
  function setTheme(id) {
    themeId = id; T = THEMES[id]; store.set('theme', id);
    applyTheme();
    if (mode === 'host') sync();
  }
  $('themes').innerHTML = ORDER.map(id => `<button type="button" class="theme-btn" data-theme="${id}"><span>${THEMES[id].icon}</span>${THEMES[id].name}</button>`).join('');
  $('themes').addEventListener('click', (e) => {
    const b = e.target.closest('.theme-btn');
    if (b && !b.disabled) setTheme(b.dataset.theme);
  });

  // ---------- board ----------
  const cellsEl = $('cells');
  for (let i = 0; i < 9; i++) {
    const c = document.createElement('button');
    c.className = 'cell'; c.type = 'button'; c.dataset.i = i;
    c.setAttribute('aria-label', `Square ${i + 1}`);
    cellsEl.appendChild(c);
  }
  cellsEl.addEventListener('click', (e) => {
    const c = e.target.closest('.cell');
    if (c) tryPlay(Number(c.dataset.i));
  });
  const shown = Array(9).fill(null); // what each cell currently displays (so only new pieces animate)

  function render() {
    [...cellsEl.children].forEach((c, i) => {
      const v = board[i];
      const key = v ? v + themeId : null;
      if (shown[i] !== key) {
        c.innerHTML = v ? `<span class="piece ${v}"><span class="em${T[v].letter ? ' letter' : ''}">${T[v].em}</span><small>${T[v].name}</small></span>` : '';
        shown[i] = key;
      }
      c.disabled = !!v || !canIPlay();
      c.dataset.ghost = T[turn].letter ? '' : T[turn].em;
      c.classList.toggle('win', !!(result && result.line && result.line.includes(i)));
      c.classList.toggle('dim', !!(result && result.line && v && !result.line.includes(i)));
    });
    $('nameX').textContent = names.x; $('nameO').textContent = names.o;
    $('winsX').textContent = `${wins.x} win${wins.x === 1 ? '' : 's'}`;
    $('winsO').textContent = `${wins.o} win${wins.o === 1 ? '' : 's'}`;
    $('draws').textContent = wins.d;
    $('sideX').classList.toggle('turn', !!mode && !result && turn === 'x');
    $('sideO').classList.toggle('turn', !!mode && !result && turn === 'o');
    $('status').textContent = statusText();
  }

  function statusText() {
    if (!mode) return 'Choose how to play';
    if (result) {
      if (!result.winner) return "It's a draw!";
      const n = names[result.winner];
      return n === 'You' ? `You win! ${T[result.winner].em}` : `${n} ${T.win}`;
    }
    if (mode === 'cpu') return turn === mySide ? `Your turn ${T[turn].letter ? '(' + T[turn].em + ')' : T[turn].em}` : 'Computer is thinking…';
    if (mode === 'pass') return `${names[turn]}'s turn ${T[turn].letter ? '' : T[turn].em}`;
    return turn === mySide ? 'Your turn' : `Waiting for ${names[turn]}…`;
  }

  function canIPlay() {
    if (!mode || result) return false;
    if (mode === 'pass') return true;
    return turn === mySide;
  }

  // ---------- rules ----------
  function outcome(b) {
    for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { winner: b[l[0]], line: l };
    return b.every(Boolean) ? { winner: null, line: null } : null;
  }

  function tryPlay(i) {
    if (!canIPlay() || board[i]) return;
    if (mode === 'client') { Net.send({ type: 'move', i }); return; }
    place(i);
  }

  function place(i) {
    board[i] = turn;
    result = outcome(board);
    if (!result) turn = turn === 'x' ? 'o' : 'x';
    render();
    if (result) finish();
    if (mode === 'host') sync();
    if (mode === 'cpu' && !result && turn !== mySide) cpuTurn();
  }

  function finish() {
    if (result.winner) wins[result.winner]++; else wins.d++;
    showWinLine();
    if (result.winner) celebrate(); else $('board').classList.add('shake');
    setTimeout(() => $('board').classList.remove('shake'), 450);
    $('againBtn').hidden = false;
    render();
  }

  function showWinLine() {
    const svg = document.querySelector('.winline');
    svg.classList.remove('show');
    if (!result || !result.line) return;
    const center = (i) => [50 + (i % 3) * 100, 50 + Math.floor(i / 3) * 100];
    const [a, , c] = result.line;
    const [x1, y1] = center(a), [x2, y2] = center(c);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ext = 30 / len;
    const l = $('winLine');
    l.setAttribute('x1', x1 - dx * ext); l.setAttribute('y1', y1 - dy * ext);
    l.setAttribute('x2', x2 + dx * ext); l.setAttribute('y2', y2 + dy * ext);
    void svg.getBoundingClientRect();
    svg.classList.add('show');
  }

  function celebrate() {
    const box = $('confetti');
    box.innerHTML = '';
    for (let k = 0; k < 26; k++) {
      const i = document.createElement('i');
      i.textContent = T.confetti[k % T.confetti.length];
      const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 170;
      i.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      i.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
      i.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
      i.style.animationDelay = `${Math.random() * 0.15}s`;
      box.appendChild(i);
    }
    setTimeout(() => { box.innerHTML = ''; }, 1600);
  }

  function newRound() {
    clearTimeout(cpuTimer);
    board = Array(9).fill(null);
    result = null;
    starter = starter === 'x' ? 'o' : 'x'; // take turns going first
    turn = starter;
    document.querySelector('.winline').classList.remove('show');
    $('againBtn').hidden = true;
    render();
    if (mode === 'host') sync();
    if (mode === 'cpu' && turn !== mySide) cpuTurn();
  }

  // ---------- computer ----------
  function minimax(b, side, me) {
    const r = outcome(b);
    if (r) return { score: r.winner === me ? 10 : r.winner ? -10 : 0 };
    let best = null;
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = side;
      const s = minimax(b, side === 'x' ? 'o' : 'x', me).score * 0.9; // prefer faster wins
      b[i] = null;
      if (!best || (side === me ? s > best.score : s < best.score)) best = { score: s, i };
    }
    return best;
  }
  function cpuMove() {
    const me = turn, free = board.map((v, i) => (v ? null : i)).filter(i => i !== null);
    const mistake = { easy: 0.6, medium: 0.25, hard: 0 }[level];
    if (Math.random() < mistake) return free[Math.floor(Math.random() * free.length)];
    if (free.length === 9) return [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)];
    return minimax(board.slice(), me, me).i;
  }
  function cpuTurn() {
    clearTimeout(cpuTimer);
    render();
    cpuTimer = setTimeout(() => { if (mode === 'cpu' && !result && turn !== mySide) place(cpuMove()); }, 550 + Math.random() * 350);
  }

  // ---------- modes ----------
  function start(m, side, n) {
    mode = m; mySide = side; names = n;
    wins = { x: 0, o: 0, d: 0 };
    starter = 'o'; // newRound flips it, so X starts the first round
    $('setup').hidden = true;
    $('menuBtn').hidden = false;
    applyTheme();
    newRound();
  }
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    ['cpu', 'pass', 'online'].forEach(p => { $('pane-' + p).hidden = p !== t.dataset.tab; });
  });
  $('level').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    level = b.dataset.v;
    $('level').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  });
  $('cpuBtn').onclick = () => {
    const lv = level[0].toUpperCase() + level.slice(1);
    start('cpu', 'x', { x: 'You', o: `Computer (${lv})` });
  };
  $('passBtn').onclick = () => start('pass', 'x', { x: 'Player 1', o: 'Player 2' });
  // guests ask the host for another round; everyone else just starts one
  $('againBtn').onclick = () => (mode === 'client' ? Net.send({ type: 'again' }) : newRound());
  $('menuBtn').onclick = () => {
    if (mode === 'host' || mode === 'client') { Net.send({ type: 'leave' }); Net.teardown(); location.href = location.pathname; return; }
    clearTimeout(cpuTimer);
    mode = null;
    board = Array(9).fill(null); result = null;
    document.querySelector('.winline').classList.remove('show');
    $('setup').hidden = false; $('menuBtn').hidden = true; $('againBtn').hidden = true;
    applyTheme();
  };

  // ---------- online (host is the authority) ----------
  const myName = () => $('myName').value.trim() || 'Player';
  function sync() { Net.send({ type: 'state', board, turn, result, names, wins, themeId }); }
  $('hostBtn').onclick = () => {
    $('hostBtn').disabled = true;
    $('onlineMsg').textContent = 'Creating game…';
    Net.onData = (d) => {
      if (d.type === 'hello' && !mode) start('host', 'x', { x: myName(), o: d.name || 'Friend' });
      else if (d.type === 'move' && mode === 'host' && turn === 'o' && !result && !board[d.i]) place(d.i);
      else if (d.type === 'again' && mode === 'host' && result) newRound();
      else if (d.type === 'leave') gone();
    };
    Net.onClose = gone;
    Net.hostGame((code) => {
      $('invite').hidden = false;
      $('code').textContent = code;
      $('onlineMsg').textContent = 'Waiting for your friend to join…';
    }, (err) => { $('hostBtn').disabled = false; $('onlineMsg').textContent = 'Could not create game: ' + (err.type || err); });
  };
  $('copyBtn').onclick = () => {
    const link = `${location.origin}${location.pathname}?room=${$('code').textContent}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    $('copyBtn').textContent = 'Copied!';
    setTimeout(() => { $('copyBtn').textContent = 'Copy link'; }, 1200);
  };
  $('joinBtn').onclick = () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (!code) return;
    $('joinBtn').disabled = true;
    $('onlineMsg').textContent = 'Connecting…';
    Net.onData = (d) => {
      if (d.type === 'state') {
        if (!mode) start('client', 'o', d.names);
        const hadResult = !!result;
        board = d.board; turn = d.turn; result = d.result; names = d.names; wins = d.wins;
        if (d.themeId !== themeId) { themeId = d.themeId; T = THEMES[themeId]; applyTheme(); }
        if (!result) { document.querySelector('.winline').classList.remove('show'); $('againBtn').hidden = true; }
        render();
        if (result && !hadResult) { showWinLine(); if (result.winner) celebrate(); $('againBtn').hidden = false; }
      } else if (d.type === 'leave') gone();
    };
    Net.onClose = gone;
    Net.joinGame(code, () => {
      Net.send({ type: 'hello', name: myName() });
      $('onlineMsg').textContent = 'Connected! Starting…';
    }, (err) => { $('joinBtn').disabled = false; $('onlineMsg').textContent = 'Could not join: ' + (err.type || err); });
  };
  function gone() {
    if (!mode) return;
    $('status').textContent = 'Your friend left the game.';
    mode = mode === 'host' || mode === 'client' ? mode : null;
    result = result || { winner: null, line: null };
    [...cellsEl.children].forEach(c => { c.disabled = true; });
  }
  window.addEventListener('beforeunload', () => { if (mode === 'host' || mode === 'client') Net.send({ type: 'leave' }); });

  const room = new URLSearchParams(location.search).get('room');
  if (room) { document.querySelector('.tab[data-tab="online"]').click(); $('joinCode').value = room.toUpperCase(); }

  applyTheme();
  window.__TTT = { state: () => ({ board: board.slice(), turn, result, wins, mode }), tryPlay };
})();
