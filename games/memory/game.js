/* Memory Match with themes (Frozen, Ramayan). Flip two cards at a time and
   find every pair in as few moves as you can. Three board sizes; the best
   move count is saved per theme and level. All artwork is emoji + colour -
   no character images. */
(function () {
  'use strict';
  const LEVELS = {
    easy: { cols: 4, rows: 3 },
    medium: { cols: 4, rows: 4 },
    hard: { cols: 6, rows: 4 }
  };
  const FLIP_BACK_MS = 800;

  // symbols: [icon, name]; each theme has at least 12 for the hard board
  const THEMES = {
    frozen: {
      name: 'Frozen', icon: '❄️', title: 'Frozen Memory', back: '❄️',
      bg: ['#1d4e7a', '#06182c'], board: '#14395c', back1: '#9fdcff', back2: '#2a76b8',
      accent: '#7fd6ff', accentText: '#052238', text: '#eef8ff', muted: '#a9cde6',
      pattern: 'snow', confetti: ['❄️', '✨', '💙', '⛄'],
      symbols: [['❄️', 'Snowflake'], ['⛄', 'Olaf'], ['👑', 'Crown'], ['🏰', 'Castle'], ['🦌', 'Reindeer'], ['🧊', 'Ice'],
        ['🏔️', 'Mountain'], ['🧣', 'Scarf'], ['⛸️', 'Skates'], ['🌨️', 'Blizzard'], ['🔮', 'Magic'], ['🥕', 'Carrot'],
        ['🎿', 'Skis'], ['💙', 'Love']],
      win: 'The cold never bothered you anyway!'
    },
    ramayan: {
      name: 'Ramayan', icon: '🏹', title: 'Ramayan Memory', back: '🪔',
      bg: ['#3a1a06', '#140801'], board: '#7a3e0c', back1: '#ffc65c', back2: '#c2410c',
      accent: '#ff9f1c', accentText: '#2a1300', text: '#fff6e5', muted: '#f2cf9a',
      pattern: 'lotus', confetti: ['🪔', '🌺', '✨', '🏹'],
      symbols: [['🏹', 'Kodanda'], ['🐒', 'Hanuman'], ['🪔', 'Diya'], ['🌺', 'Lotus'], ['🛕', 'Ayodhya'], ['👑', 'Crown'],
        ['🦌', 'Golden Deer'], ['🐚', 'Shankh'], ['🌉', 'Ram Setu'], ['📿', 'Mala'], ['🔥', 'Agni'], ['🌳', 'Forest'],
        ['🦅', 'Jatayu'], ['🌞', 'Surya']],
      win: 'Jai Shri Ram! Every pair is found.'
    }
  };
  const ORDER = ['frozen', 'ramayan'];
  const PATTERNS = {
    snow: '<text x="20" y="27" font-size="16" text-anchor="middle" fill="rgba(255,255,255,0.07)">❄</text>',
    lotus: '<path d="M20 30c-6-3-8-9-6-14 3 3 5 6 6 10 1-4 3-7 6-10 2 5 0 11-6 14z" fill="rgba(255,255,255,0.06)"/>'
  };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('memory.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('memory.' + k, v); } catch (e) { /* private mode */ } }
  };

  let themeId = THEMES[store.get('theme')] ? store.get('theme') : 'frozen';
  let T = THEMES[themeId];
  let level = LEVELS[store.get('level')] ? store.get('level') : 'medium';
  let deck = [];            // {sym, el, state: 'down'|'up'|'matched'}
  let open = [];            // cards currently face up and unmatched
  let moves = 0, pairsFound = 0, totalPairs = 0;
  let startedAt = 0, timer = null, locked = false, finished = false;

  // ---------- theme ----------
  function applyTheme() {
    const s = document.documentElement.style;
    s.setProperty('--bg1', T.bg[0]); s.setProperty('--bg2', T.bg[1]);
    s.setProperty('--board', T.board);
    s.setProperty('--back1', T.back1); s.setProperty('--back2', T.back2);
    s.setProperty('--accent', T.accent); s.setProperty('--accent-text', T.accentText);
    s.setProperty('--text', T.text); s.setProperty('--muted', T.muted);
    s.setProperty('--pattern', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>${PATTERNS[T.pattern]}</svg>`)}")`);
    $('themeIcon').textContent = T.icon;
    $('themeTitle').textContent = T.title;
    document.title = T.title;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === themeId));
    document.querySelectorAll('#level button').forEach(b => b.classList.toggle('active', b.dataset.v === level));
    showBest();
  }
  $('themes').innerHTML = ORDER.map(id => `<button type="button" class="theme-btn" role="tab" data-theme="${id}"><span>${THEMES[id].icon}</span>${THEMES[id].name}</button>`).join('');
  $('themes').addEventListener('click', (e) => {
    const b = e.target.closest('.theme-btn');
    if (!b || b.dataset.theme === themeId) return;
    themeId = b.dataset.theme; T = THEMES[themeId];
    store.set('theme', themeId);
    applyTheme();
    newGame(); // the cards change, so start a fresh round
  });
  $('level').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.v === level) return;
    level = b.dataset.v; store.set('level', level);
    applyTheme();
    newGame();
  });

  // ---------- best score ----------
  const bestKey = () => `best.${themeId}.${level}`;
  function showBest() {
    const b = Number(store.get(bestKey(), 0));
    $('best').textContent = b ? b : '-';
  }

  // ---------- game ----------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newGame() {
    clearInterval(timer); timer = null;
    const { cols, rows } = LEVELS[level];
    totalPairs = (cols * rows) / 2;
    const picks = shuffle(T.symbols.slice()).slice(0, totalPairs);
    const syms = shuffle(picks.flatMap(s => [s, s]));
    const board = $('board');
    board.style.setProperty('--cols', cols); board.style.setProperty('--rows', rows);
    document.documentElement.style.setProperty('--cols', cols);
    document.documentElement.style.setProperty('--rows', rows);
    const box = $('cards');
    box.innerHTML = '';
    deck = syms.map((sym, i) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'card'; el.dataset.i = i;
      el.setAttribute('aria-label', `Card ${i + 1}`);
      el.innerHTML = `<span class="inner"><span class="face back">${T.back}</span><span class="face front"><span>${sym[0]}</span><small>${sym[1]}</small></span></span>`;
      box.appendChild(el);
      return { sym, el, state: 'down' };
    });
    open = []; moves = 0; pairsFound = 0; startedAt = 0; locked = false; finished = false;
    $('overlay').hidden = true;
    $('status').textContent = 'Find the matching pairs';
    updateStats();
  }

  function updateStats() {
    $('moves').textContent = moves;
    $('pairs').textContent = `${pairsFound}/${totalPairs}`;
    $('time').textContent = fmt(startedAt ? Date.now() - startedAt : 0);
  }
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  $('cards').addEventListener('click', (e) => {
    const el = e.target.closest('.card');
    if (el) flip(Number(el.dataset.i));
  });

  function flip(i) {
    const c = deck[i];
    if (!c || locked || finished || c.state !== 'down') return;
    if (!startedAt) {
      startedAt = Date.now();
      timer = setInterval(updateStats, 500);
    }
    c.state = 'up'; c.el.classList.add('flipped');
    open.push(c);
    if (open.length < 2) return;

    moves++;
    const [a, b] = open;
    if (a.sym === b.sym) {
      a.state = b.state = 'matched';
      [a, b].forEach(x => { x.el.classList.remove('flipped'); x.el.classList.add('matched'); x.el.disabled = true; });
      open = [];
      pairsFound++;
      $('status').textContent = `${a.sym[1]}! Nice match`;
      updateStats();
      if (pairsFound === totalPairs) win();
    } else {
      locked = true;
      [a, b].forEach(x => x.el.classList.add('wrong'));
      $('status').textContent = 'Not a match';
      updateStats();
      setTimeout(() => {
        [a, b].forEach(x => { x.state = 'down'; x.el.classList.remove('flipped', 'wrong'); });
        open = []; locked = false;
      }, FLIP_BACK_MS);
    }
  }

  function win() {
    finished = true;
    clearInterval(timer); timer = null;
    const elapsed = Date.now() - startedAt;
    updateStats();
    const prev = Number(store.get(bestKey(), 0));
    const record = !prev || moves < prev;
    if (record) store.set(bestKey(), moves);
    showBest();
    $('status').textContent = T.win;
    celebrate();
    setTimeout(() => {
      $('ovIcon').textContent = T.icon;
      $('ovTitle').textContent = record ? 'New best!' : 'All pairs found!';
      $('ovText').textContent = `${T.win} ${moves} moves in ${fmt(elapsed)}.`;
      $('overlay').hidden = false;
    }, 900);
  }

  function celebrate() {
    const box = $('confetti');
    box.innerHTML = '';
    for (let k = 0; k < 30; k++) {
      const i = document.createElement('i');
      i.textContent = T.confetti[k % T.confetti.length];
      const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 180;
      i.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      i.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
      i.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
      i.style.animationDelay = `${Math.random() * 0.15}s`;
      box.appendChild(i);
    }
    setTimeout(() => { box.innerHTML = ''; }, 1600);
  }

  $('newBtn').onclick = () => {
    if (startedAt && !finished && !confirm('Start a new game?')) return;
    newGame();
  };
  $('ovAgain').onclick = newGame;

  applyTheme();
  newGame();
  window.__MEMORY = { state: () => ({ moves, pairsFound, totalPairs, finished, deck: deck.map(c => c.sym[0]) }), flip };
})();
