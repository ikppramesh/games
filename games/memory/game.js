/* Memory Match with themes (Frozen, Ramayan, Barbie, Batman, Spider-Man, Avengers). Flip two cards at a time and
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
    },
    barbie: {
      name: 'Barbie', icon: '💖', title: 'Barbie Memory', back: '💖',
      bg: ['#ff5fb0', '#5a0a3c'], board: '#b0166f', back1: '#ffb3dc', back2: '#e0218a',
      accent: '#ff69b4', accentText: '#3d0627', text: '#fff0f8', muted: '#ffc2e3',
      pattern: 'sparkle', confetti: ['💖', '🎀', '✨', '💗', '🌸', '💄'], confettiColors: ['#ff69b4', '#ff1493', '#ffb3dc', '#e0218a', '#ffd6ec'],
      symbols: [['👠', 'Heels'], ['👑', 'Crown'], ['🏡', 'Dream House'], ['🚗', 'Convertible'], ['💄', 'Lipstick'], ['👜', 'Handbag'],
        ['⭐', 'Star'], ['💖', 'Heart'], ['🎀', 'Bow'], ['💅', 'Nails'], ['👗', 'Dress'], ['🕶️', 'Shades'],
        ['🦄', 'Unicorn'], ['🛍️', 'Shopping']],
      win: "Life in plastic, it's fantastic!"
    },
    batman: {
      name: 'Batman', icon: '🦇', title: 'Batman Memory', back: '🦇',
      bg: ['#2b2f3a', '#05060a'], board: '#14161d', back1: '#ffd60a', back2: '#b8860b',
      accent: '#ffd60a', accentText: '#0b0b0f', text: '#f4f4f6', muted: '#a8abb8',
      pattern: 'bat', confetti: ['🦇', '⚡', '💥', '🌙'],
      symbols: [['🦇', 'Bat Symbol'], ['🏎️', 'Batmobile'], ['🌃', 'Gotham'], ['🔦', 'Bat-Signal'], ['🃏', 'Joker Card'], ['🎭', 'Mask'],
        ['🪝', 'Grapnel'], ['🌙', 'Night'], ['💣', 'Bomb'], ['🕵️', 'Detective'], ['🏙️', 'Skyline'], ['⚡', 'Flash'],
        ['🦉', 'Owl'], ['🛡️', 'Armor']],
      win: 'Gotham is safe tonight.'
    },
    spiderman: {
      name: 'Spider-Man', icon: '🕷️', title: 'Spider-Man Memory', back: '🕸️',
      bg: ['#d7263d', '#1b0a2e'], board: '#1c2b6b', back1: '#ff4d5e', back2: '#a3121f',
      accent: '#ff3b4e', accentText: '#ffffff', text: '#f2f5ff', muted: '#b8c2f0',
      pattern: 'web', confetti: ['🕷️', '🕸️', '💥', '⭐'],
      symbols: [['🕷️', 'Spider'], ['🕸️', 'Web'], ['🏙️', 'New York'], ['🌆', 'Rooftops'], ['🎭', 'Mask'], ['📸', 'Camera'],
        ['💥', 'Pow'], ['🦸', 'Hero'], ['🚕', 'Taxi'], ['🍕', 'Pizza'], ['⚡', 'Spidey Sense'], ['🧪', 'Lab'],
        ['🔴', 'Red Suit'], ['🔵', 'Blue Suit']],
      win: 'With great power comes great memory!'
    },
    avengers: {
      name: 'Avengers', icon: '🛡️', title: 'Avengers Memory', back: '⭐',
      bg: ['#24408e', '#080d24'], board: '#16224f', back1: '#e8ecf5', back2: '#b3202e',
      accent: '#e63946', accentText: '#ffffff', text: '#f1f4ff', muted: '#aab6e2',
      pattern: 'star', confetti: ['⭐', '⚡', '💥', '🛡️'],
      symbols: [['🛡️', 'Shield'], ['🔨', 'Hammer'], ['⚡', 'Lightning'], ['🏹', 'Bow'], ['💎', 'Infinity Stone'], ['🤖', 'Armor'],
        ['🕷️', 'Spider'], ['🦸', 'Hero'], ['💥', 'Smash'], ['🛸', 'Quinjet'], ['⭐', 'Star'], ['🧪', 'Gamma'],
        ['🏙️', 'Tower'], ['🔴', 'Reactor']],
      win: 'Avengers, assemble! Every pair is found.'
    }
  };
  const ORDER = ['frozen', 'ramayan', 'barbie', 'batman', 'spiderman', 'avengers'];
  const PATTERNS = {
    snow: '<text x="20" y="27" font-size="16" text-anchor="middle" fill="rgba(255,255,255,0.07)">❄</text>',
    lotus: '<path d="M20 30c-6-3-8-9-6-14 3 3 5 6 6 10 1-4 3-7 6-10 2 5 0 11-6 14z" fill="rgba(255,255,255,0.06)"/>',
    bat: '<path d="M20 14l3 3 6-3-2 5 5 3-6 1-2 5-4-4-4 4-2-5-6-1 5-3-2-5 6 3z" fill="rgba(255,214,10,0.07)"/>',
    star: '<path d="M20 8l3.5 8 8.5.8-6.5 5.7 2 8.5-7.5-4.5-7.5 4.5 2-8.5L8 16.8l8.5-.8z" fill="rgba(255,255,255,0.07)"/>',
    web: '<g fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"><path d="M0 0L40 40M40 0L0 40M20 0V40M0 20H40"/><circle cx="20" cy="20" r="6"/><circle cx="20" cy="20" r="13"/></g>',
    sparkle: '<path d="M20 8c1 7 3 9 10 12-7 3-9 5-10 12-1-7-3-9-10-12 7-3 9-5 10-12z" fill="rgba(255,255,255,0.1)"/>'
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
  let daily = false, rand = Math.random, log = []; // log: one entry per move, true = match

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
    document.body.dataset.theme = themeId;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === themeId));
    document.querySelectorAll('#level button').forEach(b => b.classList.toggle('active', b.dataset.v === level));
    showBest();
  }
  $('themes').innerHTML = ORDER.map(id => `<button type="button" class="theme-btn" role="tab" data-theme="${id}"><span>${THEMES[id].icon}</span>${THEMES[id].name}</button>`).join('');
  $('themes').addEventListener('click', (e) => {
    const b = e.target.closest('.theme-btn');
    if (!b || b.dataset.theme === themeId) return;
    daily = false; syncDailyUI();
    themeId = b.dataset.theme; T = THEMES[themeId];
    store.set('theme', themeId);
    applyTheme();
    newGame(); // the cards change, so start a fresh round
  });
  $('level').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.v === level) return;
    daily = false; syncDailyUI();
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
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- daily challenge ----------
  // One board per day for everyone (theme and card layout seeded by the local date), one scored attempt per day.
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayNumber = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 864e5) + 1; };
  function seededRng(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function savedResult() {
    try { const r = JSON.parse(store.get('daily.result', 'null')); return r && r.date === dayKey(new Date()) ? r : null; } catch (e) { return null; }
  }
  function shareText(r) {
    const th = THEMES[ORDER[dayNumber(r.date) % ORDER.length]];
    const grid = r.log.map(ok => (ok ? '🟩' : '🟥'));
    const rows = [];
    for (let i = 0; i < grid.length; i += 8) rows.push(grid.slice(i, i + 8).join(''));
    return `Memory Match Daily #${dayNumber(r.date)} · ${r.date}\n${th.icon} ${th.name}: ${r.moves} moves in ${fmt(r.ms)}\n${rows.join('\n')}\n🔥 Streak ${r.streak}\n${location.origin}${location.pathname}`;
  }
  function showDailyResult(r) {
    $('ovIcon').textContent = THEMES[ORDER[dayNumber(r.date) % ORDER.length]].icon;
    $('ovTitle').textContent = `Daily #${dayNumber(r.date)} complete`;
    $('ovText').textContent = 'Come back tomorrow for a new board!';
    $('ovShare').textContent = shareText(r);
    $('ovShare').hidden = $('ovShareBtn').hidden = false;
    $('ovAgain').textContent = 'Practice mode';
    $('overlay').hidden = false;
  }
  function finishDaily(elapsed) {
    let r = savedResult();
    if (!r) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      let streak = 1;
      try { const s = JSON.parse(store.get('daily.streak', 'null')); if (s && s.last === dayKey(y)) streak = s.n + 1; } catch (e) { /* ignore */ }
      r = { date: dayKey(new Date()), moves, ms: elapsed, log: log.slice(), streak };
      store.set('daily.result', JSON.stringify(r));
      store.set('daily.streak', JSON.stringify({ last: r.date, n: streak }));
    }
    setTimeout(() => showDailyResult(r), 900);
  }
  function syncDailyUI() {
    $('dailyBtn').classList.toggle('primary', daily);
    $('newBtn').hidden = daily;
  }
  function setDaily(on) {
    daily = on;
    if (on) {
      themeId = ORDER[dayNumber(dayKey(new Date())) % ORDER.length]; level = 'medium';
    } else {
      themeId = THEMES[store.get('theme')] ? store.get('theme') : 'frozen';
      level = LEVELS[store.get('level')] ? store.get('level') : 'medium';
    }
    T = THEMES[themeId];
    syncDailyUI();
    applyTheme();
    newGame();
  }
  $('dailyBtn').onclick = () => {
    if (startedAt && !finished && !confirm(daily ? 'Leave the daily game?' : 'Switch to the daily challenge? Your current game will be lost.')) return;
    setDaily(!daily);
  };
  $('ovShareBtn').onclick = async () => {
    const text = $('ovShare').textContent, b = $('ovShareBtn');
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Share result'; }, 1600); }
    } catch (e) { /* share cancelled */ }
  };

  function newGame() {
    rand = daily ? seededRng('memory-' + dayKey(new Date())) : Math.random;
    log = [];
    $('ovShare').hidden = $('ovShareBtn').hidden = true;
    $('ovAgain').textContent = 'Play again';
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
    const r = daily && savedResult();
    if (r) { finished = true; $('status').textContent = 'Daily done - practice or come back tomorrow'; showDailyResult(r); }
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
    log.push(a.sym === b.sym);
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
    if (daily) {
      $('status').textContent = T.win;
      celebrate();
      finishDaily(elapsed);
      return;
    }
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
      if (T.confettiColors) i.style.textShadow = `0 0 8px ${T.confettiColors[k % T.confettiColors.length]}`;
      const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 180;
      i.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      i.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
      i.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
      i.style.animationDelay = `${Math.random() * 0.15}s`;
      box.appendChild(i);
    }
    if (T.confettiColors) { // pink paper pieces alongside the emoji
      for (let k = 0; k < 40; k++) {
        const i = document.createElement('i');
        i.className = 'paper';
        i.style.background = T.confettiColors[k % T.confettiColors.length];
        const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 220;
        i.style.setProperty('--dx', `${Math.cos(a) * d}px`);
        i.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
        i.style.setProperty('--rot', `${(Math.random() - 0.5) * 1080}deg`);
        i.style.animationDelay = `${Math.random() * 0.25}s`;
        box.appendChild(i);
      }
    }
    setTimeout(() => { box.innerHTML = ''; }, 1600);
  }

  $('newBtn').onclick = () => {
    if (startedAt && !finished && !confirm('Start a new game?')) return;
    newGame();
  };
  $('ovAgain').onclick = () => (daily ? setDaily(false) : newGame());

  applyTheme();
  newGame();
  window.__MEMORY = { state: () => ({ moves, pairsFound, totalPairs, finished, deck: deck.map(c => c.sym[0]) }), flip };
})();
