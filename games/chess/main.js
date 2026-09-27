/* Chess UI: game modes, input, computer opponent (web worker), online play
   (PeerJS), sounds, move list, captured pieces, settings. Drawing is done by
   window.ChessRender - the 3D renderer (render3d.js) when WebGL is
   available, otherwise the 2D one (render.js). Loaded as a module so it
   runs after render3d.js. */
(function () {
  'use strict';
  const E = window.ChessEngine, R = window.ChessRender;
  const $ = (id) => document.getElementById(id);
  const canvas = $('boardCanvas');
  R.init(canvas);

  const NAMES = { P: 'Soldier', N: 'Horse', B: 'Camel', R: 'Elephant', Q: 'Queen', K: 'King' };
  const CLASSIC_NAMES = { P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King' };
  const VALUES = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

  // ---------- saved preferences ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('chess.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('chess.' + k, v); } catch (e) { /* ignore */ } }
  };
  const prefs = { pieces: store.get('pieces', 'armies'), board: store.get('board', 'wood'), hints: store.get('hints', 'on') };
  if (R.setStyle) R.setStyle({ pieces: prefs.pieces, board: prefs.board });
  if (R.is3D) $('viewTools').hidden = false;

  let game = new E.Game();
  let mode = null;          // 'cpu' | 'pass' | 'host' | 'client'
  let mySide = 'w';
  let level = 'medium';
  let names = { w: 'Ivory', b: 'Ebony' };
  let selected = -1;
  let over = null;
  let busy = false;
  let aiRequest = 0;
  let opponentGone = false;
  let flippedView = false;
  let lastSetup = null;     // to replay the same kind of game

  R.setPosition(game.board());
  requestAnimationFrame(() => setTimeout(() => $('loading').classList.add('done'), 150));

  // ---------- sound (synthesised, no files) ----------
  let audio = null, soundOn = store.get('sound', 'on') !== 'off';
  const soundIcon = () => { $('soundBtn').textContent = soundOn ? '🔊' : '🔇'; };
  soundIcon();
  $('soundBtn').onclick = () => { soundOn = !soundOn; store.set('sound', soundOn ? 'on' : 'off'); soundIcon(); };
  function ac() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function noise(a, dur, freq, q, gain, t0) {
    const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(t0 || a.currentTime);
  }
  function tone(a, f0, f1, dur, type, gain, t0) {
    const o = a.createOscillator(), g = a.createGain(), t = t0 || a.currentTime;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur);
  }
  function sfx(kind) {
    if (!soundOn) return;
    const a = ac();
    if (!a) return;
    const t = a.currentTime;
    switch (kind) {
      case 'step': noise(a, 0.07, 700, 1.2, 0.35); break;
      case 'stomp': noise(a, 0.18, 120, 0.8, 0.9); tone(a, 90, 50, 0.2, 'sine', 0.4); break;
      case 'leap': noise(a, 0.12, 900, 1, 0.25); noise(a, 0.08, 500, 1, 0.3, t + 0.5); break;
      case 'whoosh': noise(a, 0.25, 1600, 0.7, 0.35); break;
      case 'neigh': tone(a, 700, 1100, 0.18, 'sawtooth', 0.06); tone(a, 1100, 500, 0.35, 'sawtooth', 0.05, t + 0.18); break;
      case 'trumpet': tone(a, 260, 520, 0.45, 'sawtooth', 0.08); tone(a, 262, 530, 0.45, 'square', 0.03); break;
      case 'clash': tone(a, 2400, 1800, 0.35, 'square', 0.05); tone(a, 3100, 2600, 0.3, 'triangle', 0.08); noise(a, 0.1, 4000, 2, 0.4); break;
      case 'thud': noise(a, 0.15, 250, 1, 0.8); tone(a, 140, 60, 0.18, 'sine', 0.4); break;
      case 'crash': noise(a, 0.35, 180, 0.6, 1.0); tone(a, 80, 40, 0.4, 'sine', 0.6); break;
      case 'fall': noise(a, 0.3, 400, 0.8, 0.5); break;
      case 'promote': [523, 659, 784, 1046].forEach((f, i) => tone(a, f, f, 0.3, 'triangle', 0.12, t + i * 0.09)); break;
      case 'check': tone(a, 880, 880, 0.25, 'triangle', 0.15); tone(a, 660, 660, 0.3, 'triangle', 0.12, t + 0.15); break;
      case 'win': [392, 523, 659, 784].forEach((f, i) => tone(a, f, f, 0.45, 'triangle', 0.14, t + i * 0.14)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => tone(a, f, f * 0.98, 0.5, 'triangle', 0.1, t + i * 0.18)); break;
    }
  }
  document.addEventListener('pointerdown', () => ac(), { once: true });

  // ---------- segmented choices ----------
  function seg(id, initial, onPick) {
    const el = $(id);
    const set = (v) => el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    if (initial != null) set(initial);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      set(b.dataset.v);
      if (onPick) onPick(b.dataset.v);
    });
    return () => el.querySelector('button.active').dataset.v;
  }
  seg('levelChoice', level, (v) => { level = v; });
  const sidePick = seg('sideChoice');
  const hostSidePick = seg('hostSideChoice');
  seg('pieceStyleChoice', prefs.pieces, (v) => { prefs.pieces = v; store.set('pieces', v); if (R.setStyle) R.setStyle({ pieces: v }); updateHUD(); });
  seg('boardStyleChoice', prefs.board, (v) => { prefs.board = v; store.set('board', v); if (R.setStyle) R.setStyle({ board: v }); });
  seg('hintsChoice', prefs.hints, (v) => { prefs.hints = v; store.set('hints', v); if (selected >= 0) selectSquare(selected); });
  if (!R.setStyle) { $('pieceStyleChoice').parentElement.querySelectorAll('#pieceStyleChoice, #boardStyleChoice').forEach(el => { el.style.opacity = 0.4; el.style.pointerEvents = 'none'; }); }

  // ---------- mode tiles ----------
  function showMode(m) {
    document.querySelectorAll('.mode').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    $('cpuOpts').hidden = m !== 'cpu';
    $('hostOpts').hidden = m !== 'host';
    $('joinOpts').hidden = m !== 'join';
    $('passOpts').hidden = m !== 'pass';
  }
  $('modes').addEventListener('click', (e) => { const b = e.target.closest('.mode'); if (b) showMode(b.dataset.mode); });
  const room = new URLSearchParams(location.search).get('room');
  if (room) { showMode('join'); $('joinCode').value = room.toUpperCase(); }

  // ---------- settings modal ----------
  $('settingsBtn').onclick = () => { $('settingsModal').hidden = false; };
  $('settingsDone').onclick = () => { $('settingsModal').hidden = true; };
  $('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') $('settingsModal').hidden = true; });

  // ---------- camera ----------
  if (R.rotateView) {
    $('rotLeftBtn').onclick = () => R.rotateView(-45);
    $('rotRightBtn').onclick = () => R.rotateView(45);
    $('resetViewBtn').onclick = () => R.resetView();
  }

  // ---------- starting games ----------
  function startGame(m, side, playerNames) {
    mode = m;
    mySide = side;
    names = playerNames;
    game = new E.Game();
    over = null;
    selected = -1;
    busy = false;
    aiRequest++;
    flippedView = false;
    opponentGone = false;
    R.setFlipped(side === 'b', game.board());
    R.setPosition(game.board());
    R.setHighlights({ last: null, selected: -1, targets: [], check: -1, hint: null });
    $('setupPanel').hidden = true;
    $('gamePanel').hidden = false;
    $('overModal').hidden = true;
    $('undoBtn').hidden = !(m === 'cpu' || m === 'pass');
    $('hintBtn').hidden = !(m === 'cpu' || m === 'pass');
    hideBanner();
    updateHUD();
    maybeComputerMove();
  }

  function startCpu(sideChoice, lv) {
    let side = sideChoice;
    if (side === 'r') side = Math.random() < 0.5 ? 'w' : 'b';
    level = lv;
    const label = lv[0].toUpperCase() + lv.slice(1);
    lastSetup = { kind: 'cpu', side: sideChoice, level: lv };
    startGame('cpu', side, side === 'w' ? { w: 'You', b: `Computer · ${label}` } : { w: `Computer · ${label}`, b: 'You' });
  }
  $('cpuBtn').onclick = () => startCpu(sidePick(), level);
  $('passBtn').onclick = () => { lastSetup = { kind: 'pass' }; startGame('pass', 'w', { w: 'Ivory', b: 'Ebony' }); };

  // online: host
  $('createBtn').onclick = () => {
    $('createBtn').disabled = true;
    $('createBtn').textContent = 'Creating...';
    Net.onData = onNetData;
    Net.onClose = onNetClose;
    Net.hostGame((code) => {
      $('createBtn').textContent = 'Game created';
      $('roomCodeBox').hidden = false;
      $('roomCodeText').textContent = code;
      $('roomLink').value = `${location.origin}${location.pathname}?room=${code}`;
      $('hostStatusMsg').textContent = 'Waiting for your opponent to join...';
    }, (err) => {
      $('createBtn').disabled = false;
      $('createBtn').textContent = 'Create game';
      $('hostStatusMsg').textContent = 'Could not create game: ' + (err.type || err.message || err);
    });
  };
  $('copyLinkBtn').onclick = () => {
    $('roomLink').select();
    navigator.clipboard?.writeText($('roomLink').value).catch(() => document.execCommand('copy'));
    $('copyLinkBtn').textContent = 'Copied!';
    setTimeout(() => { $('copyLinkBtn').textContent = 'Copy'; }, 1200);
  };
  // online: guest
  $('joinBtn').onclick = () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (!code) return;
    $('joinBtn').disabled = true;
    $('joinBtn').textContent = 'Connecting...';
    Net.onData = onNetData;
    Net.onClose = onNetClose;
    Net.joinGame(code, () => {
      Net.send({ type: 'hello', name: $('joinName').value.trim() || 'Player 2' });
      $('joinStatusMsg').textContent = 'Connected! Waiting for the host...';
    }, (err) => {
      $('joinBtn').disabled = false;
      $('joinBtn').textContent = 'Join game';
      $('joinStatusMsg').textContent = 'Could not join: ' + (err.type || err.message || err);
    });
  };

  function onNetData(d) {
    if (d.type === 'hello' && !mode) {
      const hostSide = hostSidePick();
      const hostName = $('hostName').value.trim() || 'Player 1';
      const n = hostSide === 'w' ? { w: hostName, b: d.name || 'Player 2' } : { w: d.name || 'Player 2', b: hostName };
      Net.send({ type: 'start', names: n, guestSide: hostSide === 'w' ? 'b' : 'w' });
      startGame('host', hostSide, n);
    } else if (d.type === 'start' && !mode) {
      startGame('client', d.guestSide, d.names);
    } else if (d.type === 'move') {
      if (!busy && !over && game.turn() !== mySide) doMove({ from: d.from, to: d.to, promo: d.promo || null }, true);
    } else if (d.type === 'resign') {
      finish({ over: true, result: mySide === 'w' ? '1-0' : '0-1', reason: 'resignation' });
    } else if (d.type === 'leave') {
      onNetClose();
    }
  }
  function onNetClose() {
    if (!mode || opponentGone) return;
    opponentGone = true;
    if (!over) showBanner('Opponent left', 'The game has ended');
    updateHUD();
  }

  // ---------- moving ----------
  function myTurn() {
    if (!mode || over || busy || opponentGone) return false;
    if (mode === 'pass') return true;
    return game.turn() === mySide;
  }

  function selectSquare(sq) {
    selected = sq;
    const targets = sq >= 0 && prefs.hints === 'on' ? game.movesFrom(sq).map(m => ({ sq: m.to, capture: !!m.captured })) : [];
    R.setHighlights({ selected: sq, targets });
  }

  function onBoardClick(sq) {
    if (!myTurn() || sq < 0) return;
    const p = game.board()[sq];
    if (selected >= 0) {
      const options = game.movesFrom(selected).filter(m => m.to === sq);
      if (options.length) {
        selectSquare(-1);
        if (options.length > 1) askPromotion(E.colorOf(options[0].piece), (promo) => doMove(options.find(m => m.promo.toUpperCase() === promo)));
        else doMove(options[0]);
        return;
      }
    }
    if (p && E.colorOf(p) === game.turn()) selectSquare(sq === selected ? -1 : sq);
    else selectSquare(-1);
  }

  // click / tap, or drag a piece to its square (left button / one finger)
  let dragFrom = -1;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sq = R.squareAt(e.clientX, e.clientY);
    dragFrom = sq;
    onBoardClick(sq);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const sq = R.squareAt(e.clientX, e.clientY);
    if (dragFrom >= 0 && sq >= 0 && sq !== dragFrom && selected === dragFrom) onBoardClick(sq);
    dragFrom = -1;
  });

  function doMove(m, fromNetwork) {
    const res = game.play(m);
    if (!res) return;
    if (!fromNetwork && (mode === 'host' || mode === 'client')) Net.send({ type: 'move', from: m.from, to: m.to, promo: m.promo || null });
    busy = true;
    R.setHighlights({ selected: -1, targets: [], check: -1, last: null, hint: null });
    updateHUD();
    R.animateMove(res.move, game.board().slice(), sfx, () => {
      busy = false;
      const st = game.status();
      const kingSq = game.board().indexOf(game.turn() === 'w' ? 'K' : 'k');
      R.setHighlights({ last: { from: res.move.from, to: res.move.to }, check: st.check ? kingSq : -1 });
      if (st.over) finish(st);
      else if (st.check) { sfx('check'); flash('Check!'); }
      updateHUD();
      maybeComputerMove();
    });
  }

  function pieceName(t) { return (prefs.pieces === 'classic' ? CLASSIC_NAMES : NAMES)[t]; }

  function askPromotion(side, cb) {
    const box = $('promoOptions');
    box.innerHTML = '';
    for (const t of ['Q', 'R', 'B', 'N']) {
      const b = document.createElement('button');
      b.appendChild(R.icon(t, side, 68));
      b.appendChild(document.createTextNode(pieceName(t)));
      b.onclick = () => { $('promoModal').hidden = true; cb(t); };
      box.appendChild(b);
    }
    $('promoModal').hidden = false;
  }

  // ---------- computer + hints (web worker) ----------
  let worker = null;
  const pending = new Map();
  try {
    worker = new Worker('ai-worker.js');
    worker.onmessage = (e) => { const cb = pending.get(e.data.id); pending.delete(e.data.id); if (cb) cb(e.data.move); };
  } catch (e) { worker = null; }
  function think(fen, lv, cb) {
    const id = ++aiRequest;
    if (worker) { pending.set(id, (mv) => { if (id === aiRequest) cb(mv); }); worker.postMessage({ id, fen, level: lv }); }
    else setTimeout(() => { if (id === aiRequest) cb(E.bestMove(fen, lv)); }, 30);
  }
  function maybeComputerMove() {
    if (mode !== 'cpu' || over || busy || game.turn() === mySide) return;
    const started = performance.now();
    think(game.pos.fen(), level, (mv) => {
      if (!mv) return;
      setTimeout(() => { if (!busy && !over && game.turn() !== mySide) doMove(mv); }, Math.max(0, 450 - (performance.now() - started)));
    });
    updateHUD();
  }
  $('hintBtn').onclick = () => {
    if (!myTurn()) return;
    $('hintBtn').disabled = true;
    think(game.pos.fen(), 'medium', (mv) => {
      $('hintBtn').disabled = false;
      if (!mv || !myTurn()) return;
      R.setHighlights({ hint: { from: mv.from, to: mv.to } });
      selectSquare(mv.from);
      setTimeout(() => R.setHighlights({ hint: null }), 3500);
    });
  };

  // ---------- end of game ----------
  function finish(st) {
    over = st;
    const reason = st.reason[0].toUpperCase() + st.reason.slice(1);
    let title, icon = '🏆';
    if (st.result === '1/2-1/2') { title = 'Draw'; icon = '🤝'; }
    else {
      const winner = st.result === '1-0' ? 'w' : 'b';
      if (mode === 'pass') title = `${names[winner]} wins!`;
      else if (winner === mySide) title = 'You win!';
      else { title = mode === 'cpu' ? 'The computer wins' : `${names[winner]} wins`; icon = '⚔️'; }
      sfx(mode === 'pass' || winner === mySide ? 'win' : 'lose');
    }
    hideBanner();
    $('overIcon').textContent = icon;
    $('overTitle').textContent = title;
    $('overSub').textContent = reason;
    $('rematchBtn').hidden = !lastSetup || mode === 'host' || mode === 'client';
    setTimeout(() => { $('overModal').hidden = false; }, 600);
    updateHUD();
  }
  $('rematchBtn').onclick = () => {
    $('overModal').hidden = true;
    if (lastSetup.kind === 'cpu') startCpu(lastSetup.side, lastSetup.level);
    else startGame('pass', 'w', { w: 'Ivory', b: 'Ebony' });
  };
  $('menuBtn').onclick = () => leave();
  $('reviewBtn').onclick = () => { $('overModal').hidden = true; };

  let bannerTimer = null;
  function showBanner(title, sub) {
    clearTimeout(bannerTimer);
    const b = $('banner');
    b.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
  }
  function flash(title) { showBanner(title); bannerTimer = setTimeout(hideBanner, 1100); }
  function hideBanner() { $('banner').hidden = true; }

  // ---------- panel buttons ----------
  $('undoBtn').onclick = () => {
    if (busy || !(mode === 'cpu' || mode === 'pass') || !game.history.length) return;
    aiRequest++;
    game.undo();
    if (mode === 'cpu' && game.turn() !== mySide && game.history.length) game.undo();
    over = null;
    hideBanner();
    $('overModal').hidden = true;
    R.setPosition(game.board());
    const last = game.lastMove();
    const st = game.status();
    R.setHighlights({ selected: -1, targets: [], hint: null, last: last ? { from: last.from, to: last.to } : null, check: st.check ? game.board().indexOf(game.turn() === 'w' ? 'K' : 'k') : -1 });
    selected = -1;
    updateHUD();
    maybeComputerMove();
  };
  $('flipBtn').onclick = () => {
    if (busy) return;
    flippedView = !flippedView;
    R.setFlipped((mySide === 'b') !== flippedView, game.board());
    if (!R.is3D) R.setPosition(game.board());
    updateHUD();
  };
  $('resignBtn').onclick = () => {
    if (!mode || over || busy) return;
    if (!confirm('Resign this game?')) return;
    const loser = mode === 'pass' ? game.turn() : mySide;
    if (mode === 'host' || mode === 'client') Net.send({ type: 'resign' });
    finish({ over: true, result: loser === 'w' ? '0-1' : '1-0', reason: 'resignation' });
  };
  function leave() {
    if (mode === 'host' || mode === 'client') { Net.send({ type: 'leave' }); Net.teardown(); }
    location.href = location.pathname;
  }
  $('leaveBtn').onclick = leave;
  window.addEventListener('beforeunload', () => { if (mode === 'host' || mode === 'client') Net.send({ type: 'leave' }); });

  // ---------- HUD ----------
  const iconCache = new Map();
  function portrait(type, side, px) {
    const k = type + side + px + prefs.pieces;
    if (!iconCache.has(k)) iconCache.set(k, R.icon(type, side, px));
    const src = iconCache.get(k), cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    cv.style.width = src.style.width; cv.style.height = src.style.height;
    cv.getContext('2d').drawImage(src, 0, 0);
    cv.title = pieceName(type);
    return cv;
  }

  function updateHUD() {
    if (!mode) return;
    const bottom = (mySide === 'b') !== flippedView ? 'b' : 'w';
    const top = bottom === 'w' ? 'b' : 'w';
    const turn = game.turn();
    for (const [side, pre] of [[bottom, 'bottom'], [top, 'top']]) {
      $(pre + 'Name').textContent = names[side];
      $(pre + 'Card').classList.toggle('turn', !over && turn === side);
      const av = $(pre + 'Avatar');
      av.innerHTML = '';
      av.appendChild(portrait('K', side, 46));
      const thinking = !over && turn === side && ((mode === 'cpu' && side !== mySide) || ((mode === 'host' || mode === 'client') && side !== mySide));
      $(pre + 'Thinking').hidden = !thinking;
    }

    // captured pieces, shown with the side that took them
    const taken = { w: [], b: [] };
    for (const h of game.history) if (h.move.captured) taken[E.colorOf(h.move.piece)].push(h.move.captured.toUpperCase());
    const material = (side) => taken[side].reduce((s, t) => s + VALUES[t], 0);
    for (const [side, el] of [[bottom, $('bottomCaptured')], [top, $('topCaptured')]]) {
      el.innerHTML = '';
      const victims = side === 'w' ? 'b' : 'w';
      taken[side].sort((a, b) => VALUES[b] - VALUES[a]).forEach(t => el.appendChild(portrait(t, victims, 26)));
      const adv = material(side) - material(victims);
      if (adv > 0) { const s = document.createElement('span'); s.className = 'adv'; s.textContent = `+${adv}`; el.appendChild(s); }
    }

    const st = game.status();
    let status;
    if (over) status = over.result === '1/2-1/2' ? `Draw · ${over.reason}` : `${names[over.result === '1-0' ? 'w' : 'b']} wins · ${over.reason}`;
    else if (opponentGone) status = 'Opponent left the game';
    else if (mode === 'cpu' && turn !== mySide) status = 'Computer is thinking…';
    else if (mode === 'pass') status = `${turn === 'w' ? 'Ivory' : 'Ebony'} to move`;
    else status = turn === mySide ? 'Your move' : `Waiting for ${names[turn]}…`;
    if (!over && st.check) status = 'Check! ' + status;
    $('turnStatus').textContent = status;
    $('turnStatus').classList.toggle('check', !over && st.check);

    const list = $('moveList');
    list.innerHTML = '';
    if (!game.history.length) list.innerHTML = '<div class="empty">Moves will appear here</div>';
    game.history.forEach((h, i) => {
      if (i % 2 === 0) { const n = document.createElement('span'); n.className = 'n'; n.textContent = `${i / 2 + 1}.`; list.appendChild(n); }
      const s = document.createElement('span');
      s.textContent = h.san;
      if (i === game.history.length - 1) s.className = 'last';
      list.appendChild(s);
    });
    if (game.history.length % 2 === 1) list.appendChild(document.createElement('span'));
    list.scrollTop = list.scrollHeight;
    $('undoBtn').disabled = !game.history.length || busy;
    $('hintBtn').disabled = !myTurn();
  }

  // ---------- render loop ----------
  new ResizeObserver(() => R.resize()).observe(canvas);
  function loop(now) {
    R.draw(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__CHESS = { game: () => game, doMove, mode: () => mode };
})();
