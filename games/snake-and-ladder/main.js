(function () {
  const canvas = document.getElementById('boardCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const MARGIN = 20;
  const BOARD = W - MARGIN * 2;
  const CELL = BOARD / 10;

  const els = {
    setupPanel: document.getElementById('setupPanel'),
    gamePanel: document.getElementById('gamePanel'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    hostPanel: document.getElementById('hostPanel'),
    joinPanel: document.getElementById('joinPanel'),
    practicePanel: document.getElementById('practicePanel'),
    hostName: document.getElementById('hostName'),
    joinName: document.getElementById('joinName'),
    joinCode: document.getElementById('joinCode'),
    createBtn: document.getElementById('createBtn'),
    joinBtn: document.getElementById('joinBtn'),
    practiceBtn: document.getElementById('practiceBtn'),
    botCount: document.getElementById('botCount'),
    botCountLabel: document.getElementById('botCountLabel'),
    roomCodeBox: document.getElementById('roomCodeBox'),
    roomCodeText: document.getElementById('roomCodeText'),
    roomLink: document.getElementById('roomLink'),
    copyLinkBtn: document.getElementById('copyLinkBtn'),
    joinStatusMsg: document.getElementById('joinStatusMsg'),
    lobbyBox: document.getElementById('lobbyBox'),
    lobbyList: document.getElementById('lobbyList'),
    lobbyCount: document.getElementById('lobbyCount'),
    addBotBtn: document.getElementById('addBotBtn'),
    startTableBtn: document.getElementById('startTableBtn'),
    turnStatus: document.getElementById('turnStatus'),
    standings: document.getElementById('standings'),
    log: document.getElementById('log'),
    leaveBtn: document.getElementById('leaveBtn'),
    diceBar: document.getElementById('diceBar'),
    dice: document.getElementById('dice'),
    rollBtn: document.getElementById('rollBtn'),
    boardHint: document.getElementById('boardHint')
  };

  let mode = null;          // 'practice' | 'host' | 'client'
  let myId = null;
  let TABLE = null;          // authoritative SNL table - host/practice only
  let remoteState = null;    // latest broadcast state - client only
  let opponentGone = false;
  let botCounter = 0;
  let gameStarted = false;
  let hostTurnTimer = null;
  let rollingAnim = null;

  render(); // draw the empty board immediately, before any game starts

  // ---------- setup tabs ----------
  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      els.hostPanel.hidden = btn.dataset.tab !== 'host';
      els.joinPanel.hidden = btn.dataset.tab !== 'join';
      els.practicePanel.hidden = btn.dataset.tab !== 'practice';
    });
  });

  const params = new URLSearchParams(location.search);
  const sharedRoom = params.get('room');
  if (sharedRoom) {
    document.querySelector('.tab-btn[data-tab="join"]').click();
    els.joinCode.value = sharedRoom.toUpperCase();
  }

  els.botCount.addEventListener('input', () => {
    els.botCountLabel.textContent = `${els.botCount.value} opponent${els.botCount.value === '1' ? '' : 's'}`;
  });

  // ---------- host flow ----------
  els.createBtn.addEventListener('click', () => {
    els.createBtn.disabled = true;
    els.createBtn.textContent = 'Creating table...';
    SNLNet.onData = handleHostData;
    SNLNet.onGuestLeft = (peerId) => {
      if (!TABLE) return;
      SNL.removePlayer(TABLE, peerId);
      renderLobbyOrBroadcast();
      if (gameStarted) hostProcessTurn();
    };
    SNLNet.hostGame(
      (code) => {
        mode = 'host';
        myId = code;
        TABLE = SNL.newTable();
        SNL.addPlayer(TABLE, myId, els.hostName.value.trim() || 'Batman', false);
        els.createBtn.textContent = 'Table Created';
        els.roomCodeBox.hidden = false;
        els.roomCodeText.textContent = code;
        const link = `${location.origin}${location.pathname}?room=${code}`;
        els.roomLink.value = link;
        els.lobbyBox.hidden = false;
        renderLobbyOrBroadcast();
      },
      (err) => {
        els.createBtn.disabled = false;
        els.createBtn.textContent = 'Create Table';
        alert('Could not create table: ' + (err.message || err.type || err));
      }
    );
  });

  els.copyLinkBtn.addEventListener('click', () => {
    els.roomLink.select();
    navigator.clipboard?.writeText(els.roomLink.value).catch(() => document.execCommand('copy'));
    els.copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { els.copyLinkBtn.textContent = 'Copy'; }, 1200);
  });

  els.addBotBtn.addEventListener('click', () => {
    if (!TABLE || TABLE.players.length >= SNL.MAX_PLAYERS) return;
    botCounter += 1;
    SNL.addPlayer(TABLE, 'bot-' + botCounter, SNL.TOKEN_NAMES[TABLE.players.length] + ' (CPU)', true);
    renderLobbyOrBroadcast();
  });

  els.startTableBtn.addEventListener('click', () => {
    if (!TABLE || TABLE.players.length < 1) return;
    startGameUI();
    SNL.startGame(TABLE);
    hostProcessTurn();
  });

  function renderLobbyOrBroadcast() {
    if (!TABLE) return;
    els.lobbyCount.textContent = TABLE.players.length;
    els.lobbyList.innerHTML = TABLE.players.map(p => `
      <div class="lobby-row" style="border-left-color:${p.color}">
        <span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
        <span class="bot-tag">${p.isBot ? 'Computer' : ''}</span>
      </div>`).join('');
    els.startTableBtn.disabled = TABLE.players.length < 1;
    els.addBotBtn.disabled = TABLE.players.length >= SNL.MAX_PLAYERS;
    if (mode === 'host') broadcastState();
  }

  function handleHostData(data, fromPeerId) {
    if (data.type === 'hello') {
      SNL.addPlayer(TABLE, fromPeerId, (data.name || '').trim() || 'Player', false);
      renderLobbyOrBroadcast();
    } else if (data.type === 'roll') {
      if (!TABLE || TABLE.players[TABLE.currentIndex].id !== fromPeerId) return;
      const res = SNL.rollDice(TABLE, fromPeerId);
      if (res) hostProcessTurn();
    } else if (data.type === 'leave') {
      if (TABLE) { SNL.removePlayer(TABLE, fromPeerId); renderLobbyOrBroadcast(); if (gameStarted) hostProcessTurn(); }
    }
  }

  function broadcastState() {
    if (!TABLE) return;
    const state = SNL.serialize(TABLE);
    for (const id of SNLNet.conns.keys()) SNLNet.sendTo(id, { type: 'state', state });
  }

  // ---------- join flow ----------
  els.joinBtn.addEventListener('click', () => {
    const code = els.joinCode.value.trim().toUpperCase();
    if (!code) return;
    els.joinBtn.disabled = true;
    els.joinBtn.textContent = 'Connecting...';
    SNLNet.onData = handleGuestData;
    SNLNet.onClose = () => handleOpponentGone();
    SNLNet.joinGame(
      code,
      () => {
        mode = 'client';
        myId = SNLNet.myId;
        SNLNet.sendToHost({ type: 'hello', name: els.joinName.value.trim() || 'Player' });
        els.joinBtn.textContent = 'Connected!';
        els.joinStatusMsg.textContent = 'Waiting for the host to start the game...';
      },
      (err) => {
        els.joinBtn.disabled = false;
        els.joinBtn.textContent = 'Join Table';
        alert('Could not join table: ' + (err.message || err.type || err));
      }
    );
  });

  function handleGuestData(data) {
    if (data.type === 'state') {
      const prevRoll = remoteState && remoteState.lastRoll;
      const prevTurn = remoteState && remoteState.turnNumber;
      remoteState = data.state;
      if (remoteState.stage === 'waiting') {
        els.joinStatusMsg.textContent = `Waiting for the host to start... (${remoteState.players.length} seated)`;
      } else if (!gameStarted) {
        startGameUI();
      }
      if (remoteState.turnNumber !== prevTurn || remoteState.lastRoll !== prevRoll) settleDice(remoteState.lastRoll);
      render();
      updateHUD();
    } else if (data.type === 'leave') {
      handleOpponentGone();
    }
  }

  // ---------- practice flow ----------
  els.practiceBtn.addEventListener('click', () => {
    mode = 'practice';
    myId = 'you';
    TABLE = SNL.newTable();
    SNL.addPlayer(TABLE, myId, 'You', false);
    const n = Number(els.botCount.value);
    for (let i = 1; i <= n; i++) SNL.addPlayer(TABLE, 'bot-' + i, SNL.TOKEN_NAMES[i] + ' (CPU)', true);
    startGameUI();
    SNL.startGame(TABLE);
    hostProcessTurn();
  });

  // ---------- shared game flow ----------
  function startGameUI() {
    gameStarted = true;
    els.setupPanel.hidden = true;
    els.gamePanel.hidden = false;
    els.diceBar.hidden = false;
    els.boardHint.textContent = 'Good luck out there.';
  }

  function isAuthority() { return mode === 'practice' || mode === 'host'; }
  function currentState() { return isAuthority() ? (TABLE ? SNL.serialize(TABLE) : null) : remoteState; }
  function myTurn(state) { return !!state && state.stage === 'playing' && state.players[state.currentIndex] && state.players[state.currentIndex].id === myId; }

  function hostProcessTurn() {
    if (!TABLE) return;
    broadcastState();
    render();
    updateHUD();
    clearTimeout(hostTurnTimer);

    if (TABLE.stage !== 'playing') return;
    const actor = TABLE.players[TABLE.currentIndex];
    if (actor && actor.isBot) {
      hostTurnTimer = setTimeout(() => {
        if (!TABLE || TABLE.stage !== 'playing' || TABLE.players[TABLE.currentIndex].id !== actor.id) return;
        const res = SNL.rollDice(TABLE, actor.id);
        if (res) hostProcessTurn();
      }, 700 + Math.random() * 500);
    }
  }

  function submitRoll() {
    if (mode === 'client') {
      SNLNet.sendToHost({ type: 'roll' });
    } else if (TABLE) {
      const res = SNL.rollDice(TABLE, myId);
      if (res) hostProcessTurn();
    }
  }

  // ---------- dice animation ----------
  function startRollingAnim() {
    clearInterval(rollingAnim);
    els.dice.classList.add('rolling');
    rollingAnim = setInterval(() => {
      els.dice.dataset.face = String(1 + Math.floor(Math.random() * 6));
    }, 80);
  }
  function settleDice(finalRoll) {
    clearInterval(rollingAnim);
    rollingAnim = null;
    els.dice.classList.remove('rolling');
    if (finalRoll) els.dice.dataset.face = String(finalRoll);
  }

  els.rollBtn.addEventListener('click', () => {
    const state = currentState();
    if (!myTurn(state)) return;
    els.rollBtn.disabled = true;
    startRollingAnim();
    submitRoll();
    // for the authority, the result is already known synchronously - settle after a short flourish
    if (isAuthority()) {
      setTimeout(() => settleDice(currentState().lastRoll), 550);
    } else {
      // guest: settleDice() is triggered from handleGuestData once the host's
      // broadcast arrives; this timeout is just a safety net in case it's slow
      setTimeout(() => { if (rollingAnim) settleDice(currentState() && currentState().lastRoll); }, 2500);
    }
  });

  function handleOpponentGone() {
    opponentGone = true;
    els.turnStatus.textContent = 'Lost connection to the host.';
  }

  els.leaveBtn.addEventListener('click', () => {
    if (mode === 'host' || mode === 'client') {
      if (mode === 'client') SNLNet.sendToHost({ type: 'leave' });
      SNLNet.teardown();
    }
    clearTimeout(hostTurnTimer);
    clearInterval(rollingAnim);
    location.reload();
  });

  window.addEventListener('beforeunload', () => {
    if (mode === 'client') SNLNet.sendToHost({ type: 'leave' });
  });

  // ---------- HUD ----------
  function updateHUD() {
    const state = currentState();
    if (!state) return;
    const acting = state.players[state.currentIndex];
    if (state.stage === 'finished' && state.winner) {
      const w = state.players.find(p => p.id === state.winner);
      els.turnStatus.textContent = `🦇 ${w ? w.name : 'Someone'} saved Gotham!`;
    } else if (opponentGone) {
      els.turnStatus.textContent = 'Connection lost.';
    } else if (acting) {
      els.turnStatus.textContent = acting.id === myId ? 'Your roll!' : `${acting.name}'s turn...`;
    } else {
      els.turnStatus.textContent = 'Waiting...';
    }

    const iRoll = myTurn(state);
    els.rollBtn.disabled = !iRoll || state.stage !== 'playing';
    if (state.stage === 'finished') els.rollBtn.disabled = true;

    els.standings.innerHTML = state.players.slice().sort((a, b) => b.pos - a.pos).map(p => `
      <div class="lobby-row" style="border-left-color:${p.color}">
        <span>${p.id === state.players[state.currentIndex]?.id && state.stage === 'playing' ? '&#9654; ' : ''}${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}${!p.active ? ' (left)' : ''}</span>
        <span class="bot-tag">${p.pos}/100</span>
      </div>`).join('');

    const logLines = state.log.slice(-10);
    els.log.innerHTML = logLines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    els.log.scrollTop = els.log.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- canvas rendering ----------
  function cellTopLeft(row, col) { return { x: MARGIN + col * CELL, y: MARGIN + (9 - row) * CELL }; }
  function squareCenter(n) {
    const { row, col } = SNL.squareToRowCol(Math.max(1, n));
    const tl = cellTopLeft(row, col);
    return { x: tl.x + CELL / 2, y: tl.y + CELL / 2 };
  }

  function drawBat(cx, cy, size, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(size / 40, size / 40);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.bezierCurveTo(-4, -14, -16, -12, -20, -2);
    ctx.bezierCurveTo(-12, -4, -8, 2, -6, 0);
    ctx.bezierCurveTo(-8, 8, -14, 12, -14, 16);
    ctx.bezierCurveTo(-6, 12, -3, 6, 0, 8);
    ctx.bezierCurveTo(3, 6, 6, 12, 14, 16);
    ctx.bezierCurveTo(14, 12, 8, 8, 6, 0);
    ctx.bezierCurveTo(8, 2, 12, -4, 20, -2);
    ctx.bezierCurveTo(16, -12, 4, -14, 0, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  function drawLadder(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // perpendicular
    const railOffset = 7;
    const rail1 = { x0: x0 + nx * railOffset, y0: y0 + ny * railOffset, x1: x1 + nx * railOffset, y1: y1 + ny * railOffset };
    const rail2 = { x0: x0 - nx * railOffset, y0: y0 - ny * railOffset, x1: x1 - nx * railOffset, y1: y1 - ny * railOffset };
    ctx.strokeStyle = '#f6c93b';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    [rail1, rail2].forEach(r => { ctx.beginPath(); ctx.moveTo(r.x0, r.y0); ctx.lineTo(r.x1, r.y1); ctx.stroke(); });
    const rungs = Math.max(3, Math.floor(len / 22));
    ctx.lineWidth = 2.5;
    for (let i = 1; i < rungs; i++) {
      const t = i / rungs;
      const cx = x0 + dx * t, cy = y0 + dy * t;
      ctx.beginPath();
      ctx.moveTo(cx + nx * railOffset, cy + ny * railOffset);
      ctx.lineTo(cx - nx * railOffset, cy - ny * railOffset);
      ctx.stroke();
    }
  }

  // A jagged purple/green "Joker's trick" trail instead of a snake, capped
  // with a small Joker face badge at the head (high) square.
  function drawJokerTrail(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const wiggle = Math.min(30, len * 0.22);
    const mid1 = { x: x0 + dx * 0.33 + nx * wiggle, y: y0 + dy * 0.33 + ny * wiggle };
    const mid2 = { x: x0 + dx * 0.66 - nx * wiggle, y: y0 + dy * 0.66 - ny * wiggle };

    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(mid1.x, mid1.y, mid2.x, mid2.y, x1, y1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(61,220,114,0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    drawJokerFace(x0, y0);
  }

  function drawJokerFace(cx, cy) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f1ea';
    ctx.fill();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#3ddc72';
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 6); ctx.lineTo(cx - 13, cy - 13); ctx.lineTo(cx - 5, cy - 9); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 9, cy - 6); ctx.lineTo(cx + 13, cy - 13); ctx.lineTo(cx + 5, cy - 9); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#e0264f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(cx - 3.5, cy - 2, 1.2, 0, Math.PI * 2);
    ctx.arc(cx + 3.5, cy - 2, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // A little Batmobile silhouette for each player's token instead of a
  // plain colored disc: low sleek body, tail fin, cockpit glass, wheels.
  function drawBatmobile(cx, cy, size, color, isMe) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.translate(cx, cy);
    const s = size / 20;
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 9, 15, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-16, 4);
    ctx.bezierCurveTo(-16, -2, -12, -6, -6, -6);
    ctx.bezierCurveTo(-4, -10, 4, -10, 6, -6);
    ctx.bezierCurveTo(12, -6, 16, -2, 16, 4);
    ctx.bezierCurveTo(16, 7, 12, 8, 8, 8);
    ctx.lineTo(-8, 8);
    ctx.bezierCurveTo(-12, 8, -16, 7, -16, 4);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = isMe ? 1.6 : 1;
    ctx.strokeStyle = isMe ? '#fff' : 'rgba(0,0,0,0.5)';
    ctx.stroke();

    // tail fin
    ctx.beginPath();
    ctx.moveTo(14, 1); ctx.lineTo(21, -4); ctx.lineTo(16, 3); ctx.closePath();
    ctx.fill();

    // cockpit glass
    ctx.fillStyle = 'rgba(190,225,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(-5, -6); ctx.lineTo(-2, -9); ctx.lineTo(4, -9); ctx.lineTo(5, -6); ctx.closePath();
    ctx.fill();

    // wheels
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-9, 8, 3, 0, Math.PI * 2);
    ctx.arc(9, 8, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawToken(x, y, color, isMe) {
    drawBatmobile(x, y, 26, color, isMe);
  }

  function render() {
    const state = currentState();
    ctx.clearRect(0, 0, W, H);

    // backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#171a22');
    bg.addColorStop(1, '#05060a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // bat-signal glow, top-right corner of the margin
    const glow = ctx.createRadialGradient(W - 34, 34, 2, W - 34, 34, 70);
    glow.addColorStop(0, 'rgba(246,201,59,0.35)');
    glow.addColorStop(1, 'rgba(246,201,59,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    drawBat(W - 34, 34, 22, 'rgba(20,18,10,0.85)');

    // board squares
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const tl = cellTopLeft(row, col);
        const dark = (row + col) % 2 === 0;
        ctx.fillStyle = dark ? '#12141b' : '#1a1d27';
        ctx.fillRect(tl.x, tl.y, CELL, CELL);
        ctx.strokeStyle = 'rgba(246,201,59,0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, CELL - 1, CELL - 1);
      }
    }
    // number labels
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let n = 1; n <= 100; n++) {
      const { row, col } = SNL.squareToRowCol(n);
      const tl = cellTopLeft(row, col);
      ctx.fillText(n, tl.x + 4, tl.y + 3);
    }
    // outer border
    ctx.strokeStyle = '#f6c93b';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(MARGIN, MARGIN, BOARD, BOARD);

    if (!state) return;

    // ladders then Joker traps - each game has its own random layout
    Object.entries(state.ladders || {}).forEach(([from, to]) => {
      const a = squareCenter(Number(from)), b = squareCenter(to);
      drawLadder(a.x, a.y, b.x, b.y);
    });
    Object.entries(state.jokers || {}).forEach(([from, to]) => {
      const a = squareCenter(Number(from)), b = squareCenter(to);
      drawJokerTrail(a.x, a.y, b.x, b.y);
    });

    // tokens, offset within a cell if several share a square
    const bySquare = {};
    for (const p of state.players) {
      const key = p.pos;
      (bySquare[key] = bySquare[key] || []).push(p);
    }
    Object.entries(bySquare).forEach(([sq, group]) => {
      const center = squareCenter(Number(sq) || 1);
      const offsets = [[0, 0], [-14, -14], [14, -14], [-14, 14], [14, 14]];
      group.forEach((p, i) => {
        const off = offsets[i] || [0, 0];
        drawToken(center.x + off[0] * 0.6, center.y + off[1] * 0.6, p.color, p.id === myId);
      });
    });

    if (state.stage === 'finished' && state.winner) {
      const w = state.players.find(p => p.id === state.winner);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const bw = 320;
      ctx.fillRect(W / 2 - bw / 2, H / 2 - 24, bw, 48);
      ctx.strokeStyle = '#f6c93b';
      ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - bw / 2, H / 2 - 24, bw, 48);
      ctx.fillStyle = '#f6c93b';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${w ? w.name : 'Someone'} saved Gotham!`, W / 2, H / 2);
    }
  }

  setInterval(() => { if (gameStarted) render(); }, 1000);

  window.__SNL_DEBUG = { getState: currentState, getTable: () => TABLE, getMode: () => mode, getMyId: () => myId };
})();
