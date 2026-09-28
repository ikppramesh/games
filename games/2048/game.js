/* 2048 with themes. Slide tiles; two equal tiles merge into the next tier.
   Each theme names and draws every tier from 2 to 2048 (and beyond).
   All artwork is emoji + colour - no character images. */
(function () {
  'use strict';
  const SIZE = 4, WIN = 2048, MOVE_MS = 110;

  // tiers: [icon, name] for 2, 4, 8 ... 2048, then a "beyond" tier
  const THEMES = {
    barbie: {
      name: 'Barbie', icon: '🎀', title: 'Dream 2048',
      bg: ['#3a0f2c', '#16040f'], board: '#6e2a55', cell: 'rgba(255,255,255,0.14)',
      accent: '#ff5fa8', accentText: '#fff', text: '#fff5fb', muted: '#f3c2dd',
      colors: ['#ffe4f1', '#ffc8e3', '#ffa6d1', '#ff85bf', '#ff5fa8', '#f0418f', '#d62f7c', '#c084fc', '#a855f7', '#f5c542', '#ffd700', '#1b0a14'],
      tiers: [['🎀', 'Bow'], ['💄', 'Lipstick'], ['💅', 'Nails'], ['👛', 'Purse'], ['👠', 'Heels'], ['👗', 'Gown'], ['🕶️', 'Shades'], ['💍', 'Ring'], ['🦄', 'Unicorn'], ['🏰', 'Castle'], ['👑', 'Crown'], ['💖', 'Legend']],
      pattern: 'hearts', win: 'Dream House unlocked! You are a true icon.'
    },
    batman: {
      name: 'Batman', icon: '🦇', title: 'Gotham 2048',
      bg: ['#1b1d24', '#050608'], board: '#23262f', cell: 'rgba(255,255,255,0.06)',
      accent: '#f6c93b', accentText: '#141208', text: '#eef0f4', muted: '#a9adb8',
      colors: ['#3a3f4b', '#4a505e', '#5c6272', '#6f7688', '#2c313c', '#1c1f27', '#11131a', '#f2b705', '#f6c93b', '#ffd95e', '#ffe98a', '#fff4c2'],
      tiers: [['🦇', 'Bat'], ['🌙', 'Moon'], ['🔦', 'Signal'], ['🏙️', 'Gotham'], ['🥋', 'Training'], ['🛡️', 'Armor'], ['🧰', 'Utility'], ['🏍️', 'Batcycle'], ['🚗', 'Batmobile'], ['✈️', 'Batwing'], ['🏆', 'Dark Knight'], ['⭐', 'Legend']],
      pattern: 'bats', win: 'Gotham is safe. The Dark Knight rises!'
    },
    spider: {
      name: 'Spider-Man', icon: '🕷️', title: 'Web 2048',
      bg: ['#16204a', '#060a1c'], board: '#1f3170', cell: 'rgba(255,255,255,0.1)',
      accent: '#e8323f', accentText: '#fff', text: '#f4f6ff', muted: '#b7c2ec',
      colors: ['#e3e8f7', '#c9d3f2', '#8aa4ec', '#5b7fe0', '#2f5bd3', '#1d3fa8', '#e8323f', '#cc1f2c', '#a3121c', '#7a0e16', '#ffd23f', '#111827'],
      tiers: [['🕷️', 'Spider'], ['🕸️', 'Web'], ['📸', 'Camera'], ['🎒', 'Backpack'], ['🛹', 'Skate'], ['🌆', 'City'], ['🚇', 'Subway'], ['🏗️', 'Crane'], ['🚁', 'Chopper'], ['🗽', 'Skyline'], ['🦸', 'Hero'], ['💥', 'Legend']],
      pattern: 'web', win: 'Your friendly neighbourhood hero saved the city!'
    },
    ramayan: {
      name: 'Ramayan', icon: '🏹', title: 'Ramayan 2048',
      bg: ['#3a1a06', '#140801'], board: '#7a3e0c', cell: 'rgba(255,230,180,0.14)',
      accent: '#ff9f1c', accentText: '#2a1300', text: '#fff6e5', muted: '#f2cf9a',
      colors: ['#fff1d0', '#ffe0a3', '#ffcd73', '#ffb347', '#ff9f1c', '#f47c0f', '#e05e0b', '#c2410c', '#b45309', '#d4af37', '#ffd700', '#3b1d05'],
      tiers: [['🪔', 'Diya'], ['🌺', 'Lotus'], ['📿', 'Mala'], ['🐚', 'Shankh'], ['🌳', 'Forest'], ['🦌', 'Golden Deer'], ['🐒', 'Vanara'], ['🌉', 'Ram Setu'], ['🏹', 'Kodanda'], ['🛕', 'Ayodhya'], ['👑', 'Ram Rajya'], ['🌞', 'Surya']],
      pattern: 'lotus', win: 'Jai Shri Ram! You have reached Ram Rajya.'
    }
  };
  const ORDER = ['barbie', 'batman', 'spider', 'ramayan'];
  const PATTERNS = {
    hearts: (c) => `<text x="20" y="27" font-size="16" text-anchor="middle" fill="${c}">♥</text>`,
    bats: (c) => `<path d="M20 16c-2-4-7-5-10-2 3 0 5 2 5 4-3-1-6 0-7 3 3-1 6 0 8 2 1-1 3-2 4-2s3 1 4 2c2-2 5-3 8-2-1-3-4-4-7-3 0-2 2-4 5-4-3-3-8-2-10 2z" fill="${c}"/>`,
    web: (c) => `<g stroke="${c}" stroke-width="0.8" fill="none"><path d="M0 0L40 40M40 0L0 40M20 0V40M0 20H40"/><circle cx="20" cy="20" r="7"/><circle cx="20" cy="20" r="14"/></g>`,
    lotus: (c) => `<path d="M20 30c-6-3-8-9-6-14 3 3 5 6 6 10 1-4 3-7 6-10 2 5 0 11-6 14z" fill="${c}"/>`
  };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('2048.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('2048.' + k, v); } catch (e) { /* private mode */ } }
  };

  let themeId = THEMES[store.get('theme')] ? store.get('theme') : 'barbie';
  let T = THEMES[themeId];
  let tiles = [];       // {id, value, r, c, el, merged?, isNew?}
  let score = 0, won = false, over = false, keepPlaying = false;
  let nextId = 1, undoState = null, busy = false;

  // ---------- theme ----------
  function tierIndex(v) { return Math.min(Math.log2(v) - 1, T.tiers.length - 1); }
  function applyTheme() {
    const s = document.documentElement.style;
    s.setProperty('--bg1', T.bg[0]); s.setProperty('--bg2', T.bg[1]);
    s.setProperty('--board', T.board); s.setProperty('--cell', T.cell);
    s.setProperty('--accent', T.accent); s.setProperty('--accent-text', T.accentText);
    s.setProperty('--text', T.text); s.setProperty('--muted', T.muted);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>${PATTERNS[T.pattern]('rgba(255,255,255,0.05)')}</svg>`;
    s.setProperty('--pattern', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    $('themeIcon').textContent = T.icon;
    $('themeTitle').textContent = T.title;
    document.title = T.title;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === themeId));
    $('best').textContent = best();
    tiles.forEach(paintTile);
    renderJourney();
  }
  function best() { return Number(store.get('best.' + themeId, 0)); }

  $('themes').innerHTML = ORDER.map(id => `<button type="button" class="theme-btn" role="tab" data-theme="${id}"><span>${THEMES[id].icon}</span>${THEMES[id].name}</button>`).join('');
  $('themes').addEventListener('click', (e) => {
    const b = e.target.closest('.theme-btn');
    if (!b || b.dataset.theme === themeId) return;
    themeId = b.dataset.theme;
    T = THEMES[themeId];
    store.set('theme', themeId);
    applyTheme(); // the game carries on in the new theme
    $('board').focus();
  });

  // ---------- board ----------
  const cellsEl = $('cells'), tilesEl = $('tiles');
  const posVar = (i) => `calc(var(--gap) + (var(--gap) + var(--tile)) * ${i})`;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.style.left = posVar(c); d.style.top = posVar(r);
    cellsEl.appendChild(d);
  }

  function paintTile(t) {
    const i = tierIndex(t.value);
    const [icon, name] = T.tiers[i];
    const bg = T.colors[Math.min(i, T.colors.length - 1)];
    const face = t.el.querySelector('.face');
    face.style.setProperty('--t-bg', `linear-gradient(160deg, ${shadeHex(bg, 28)}, ${bg} 60%, ${shadeHex(bg, -22)})`);
    face.style.setProperty('--t-fg', luminance(bg) > 0.55 ? '#2a1a22' : '#ffffff');
    if (i >= 8) { face.style.setProperty('--t-glow', 'calc(var(--tile) * 0.18)'); face.style.setProperty('--t-glowc', bg); }
    else { face.style.removeProperty('--t-glow'); }
    const digits = String(t.value).length;
    face.style.setProperty('--nsize', digits <= 2 ? 0.22 : digits === 3 ? 0.19 : 0.16);
    face.innerHTML = `<span class="icon">${icon}</span><span class="num">${t.value}</span><span class="name">${name}</span>`;
  }

  function place(t) { t.el.style.setProperty('--x', posVar(t.c)); t.el.style.setProperty('--y', posVar(t.r)); }

  function addTileEl(t, cls) {
    t.el = document.createElement('div');
    t.el.className = 'tile' + (cls ? ' ' + cls : '');
    t.el.innerHTML = '<div class="face"></div>';
    place(t);
    paintTile(t);
    tilesEl.appendChild(t.el);
  }

  function empties() {
    const taken = new Set(tiles.filter(t => !t.dying).map(t => t.r * SIZE + t.c));
    const out = [];
    for (let i = 0; i < SIZE * SIZE; i++) if (!taken.has(i)) out.push(i);
    return out;
  }
  function spawn() {
    const e = empties();
    if (!e.length) return;
    const i = e[Math.floor(Math.random() * e.length)];
    const t = { id: nextId++, value: Math.random() < 0.9 ? 2 : 4, r: Math.floor(i / SIZE), c: i % SIZE };
    tiles.push(t);
    addTileEl(t, 'new');
  }

  // ---------- moving ----------
  const DIRS = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
  function move(dir) {
    if (busy || over || (won && !keepPlaying)) return;
    const [dr, dc] = DIRS[dir];
    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    tiles.forEach(t => { grid[t.r][t.c] = t; });
    const rows = [...Array(SIZE).keys()], cols = [...Array(SIZE).keys()];
    if (dr === 1) rows.reverse();
    if (dc === 1) cols.reverse();
    const snapshot = { tiles: tiles.map(t => ({ value: t.value, r: t.r, c: t.c })), score };
    const mergedNow = new Set();
    let moved = false, gained = 0;
    const born = [];

    for (const r of rows) for (const c of cols) {
      const t = grid[r][c];
      if (!t) continue;
      let nr = r, nc = c;
      while (true) {
        const tr = nr + dr, tc = nc + dc;
        if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE || grid[tr][tc]) break;
        nr = tr; nc = tc;
      }
      const br = nr + dr, bc = nc + dc;
      const blocker = br >= 0 && br < SIZE && bc >= 0 && bc < SIZE ? grid[br][bc] : null;
      grid[r][c] = null;
      if (blocker && blocker.value === t.value && !mergedNow.has(blocker)) {
        // both slide into the blocker's square, then become one bigger tile
        const nt = { id: nextId++, value: t.value * 2, r: br, c: bc };
        grid[br][bc] = nt;
        mergedNow.add(nt);
        t.r = br; t.c = bc; t.dying = true; blocker.dying = true;
        born.push(nt);
        gained += nt.value;
        moved = true;
      } else {
        grid[nr][nc] = t;
        if (nr !== r || nc !== c) moved = true;
        t.r = nr; t.c = nc;
      }
    }
    if (!moved) { nudge(dir); return; }

    undoState = snapshot;
    $('undoBtn').disabled = false;
    busy = true;
    tiles.forEach(t => { t.el.classList.remove('new', 'merged'); place(t); });
    born.forEach(nt => { tiles.push(nt); addTileEl(nt, 'merged'); });
    score += gained;
    if (gained) showPlus(gained);
    updateScore();

    setTimeout(() => {
      tiles.filter(t => t.dying).forEach(t => t.el.remove());
      tiles = tiles.filter(t => !t.dying);
      spawn();
      busy = false;
      renderJourney();
      checkEnd();
    }, MOVE_MS);
  }

  // a small shove when nothing can move that way
  function nudge(dir) {
    const b = $('board');
    const [dr, dc] = DIRS[dir];
    b.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${dc * 6}px, ${dr * 6}px)` }, { transform: 'translate(0,0)' }], { duration: 160 });
  }

  function canMove() {
    if (tiles.length < SIZE * SIZE) return true;
    const g = {};
    tiles.forEach(t => { g[t.r * SIZE + t.c] = t.value; });
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const v = g[r * SIZE + c];
      if (c + 1 < SIZE && g[r * SIZE + c + 1] === v) return true;
      if (r + 1 < SIZE && g[(r + 1) * SIZE + c] === v) return true;
    }
    return false;
  }

  function checkEnd() {
    if (!won && tiles.some(t => t.value >= WIN)) {
      won = true;
      showOverlay('🏆', 'You made 2048!', T.win, 'Keep going', () => { keepPlaying = true; hideOverlay(); });
      return;
    }
    if (!canMove()) {
      over = true;
      const top = Math.max(...tiles.map(t => t.value));
      const [icon, name] = T.tiers[tierIndex(top)];
      showOverlay(icon, 'No more moves', `You reached ${name} (${top}) with ${score.toLocaleString('en-IN')} points.`, 'Try again', newGame);
    }
  }

  // ---------- score / UI ----------
  function updateScore() {
    $('score').textContent = score.toLocaleString('en-IN');
    if (score > best()) store.set('best.' + themeId, score);
    $('best').textContent = best().toLocaleString('en-IN');
  }
  function showPlus(n) {
    const p = $('plus');
    p.textContent = '+' + n;
    p.classList.remove('show'); void p.offsetWidth; p.classList.add('show');
  }
  function renderJourney() {
    const top = tiles.length ? Math.max(...tiles.map(t => t.value)) : 2;
    const topI = tierIndex(top);
    $('journey').innerHTML = T.tiers.slice(0, 11).map(([icon, name], i) =>
      `<div class="step${i <= topI ? ' done' : ''}${i === topI ? ' top' : ''}" title="${2 ** (i + 1)} · ${name}"><span>${icon}</span><small>${2 ** (i + 1)}</small></div>`).join('');
  }
  let ovAction = null;
  function showOverlay(icon, title, text, mainLabel, action) {
    $('ovIcon').textContent = icon; $('ovTitle').textContent = title; $('ovText').textContent = text;
    $('ovMain').textContent = mainLabel; ovAction = action;
    $('overlay').hidden = false;
  }
  function hideOverlay() { $('overlay').hidden = true; $('board').focus(); }
  $('ovMain').onclick = () => ovAction && ovAction();
  $('ovNew').onclick = newGame;

  function newGame() {
    tilesEl.innerHTML = '';
    tiles = []; score = 0; won = false; over = false; keepPlaying = false; undoState = null; busy = false;
    $('undoBtn').disabled = true;
    hideOverlay();
    spawn(); spawn();
    updateScore();
    renderJourney();
  }
  $('newBtn').onclick = () => {
    if (score > 0 && !over && !confirm('Start a new game?')) return;
    newGame();
  };
  $('undoBtn').onclick = () => {
    if (!undoState || busy) return;
    tilesEl.innerHTML = '';
    tiles = undoState.tiles.map(t => ({ id: nextId++, ...t }));
    tiles.forEach(t => addTileEl(t));
    score = undoState.score;
    over = false;
    undoState = null;
    $('undoBtn').disabled = true;
    hideOverlay();
    updateScore();
    renderJourney();
  };

  // ---------- input: keys, swipe, mouse drag ----------
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down' };
  document.addEventListener('keydown', (e) => {
    const dir = KEYS[e.key];
    if (!dir || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    move(dir);
  });
  let start = null;
  const board = $('board');
  board.addEventListener('pointerdown', (e) => { if (e.target.closest('.overlay')) return; start = { x: e.clientX, y: e.clientY }; board.setPointerCapture(e.pointerId); });
  board.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  board.addEventListener('pointercancel', () => { start = null; });

  // ---------- colour helpers ----------
  function shadeHex(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, v + amt)));
    return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
  }
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  applyTheme();
  newGame();
  board.focus();
  window.__G2048 = { state: () => ({ score, tiles: tiles.map(t => [t.r, t.c, t.value]), won, over }), move, setTiles: (list) => {
    tilesEl.innerHTML = ''; tiles = list.map(([r, c, value]) => ({ id: nextId++, r, c, value })); tiles.forEach(t => addTileEl(t)); renderJourney();
  } };
})();
