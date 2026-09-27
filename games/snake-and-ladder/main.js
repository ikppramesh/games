(function () {
  const canvas = document.getElementById('boardCanvas');
  const ctx = SNLRender.init(canvas);

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
  let animating = false; // a move animation is playing (see render.js)

  // ---------- board theme ----------
  // The picker sets the theme for practice games and tables you host; guests
  // always see the host's pick (it arrives in the game state).
  const themeStore = {
    get() { try { return localStorage.getItem('snl.theme'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('snl.theme', v); } catch (e) { /* ignore */ } }
  };
  let selectedTheme = SNLThemes.list[themeStore.get()] ? themeStore.get() : SNLThemes.DEFAULT;
  const themeOptionsEl = document.getElementById('themeOptions');
  themeOptionsEl.innerHTML = SNLThemes.order.map(id => {
    const t = SNLThemes.list[id];
    return `<button type="button" class="theme-opt" data-theme="${id}"><span class="ti">${t.icon}</span>${t.name}</button>`;
  }).join('');
  themeOptionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-opt');
    if (!btn || btn.disabled) return;
    selectedTheme = btn.dataset.theme;
    themeStore.set(selectedTheme);
    if (mode === 'host' && TABLE && TABLE.stage === 'waiting') {
      const t = SNLThemes.get(selectedTheme);
      SNL.setTheme(TABLE, selectedTheme, t.colors, t.botNames);
      renderLobbyOrBroadcast();
    }
    applyTheme();
  });

  function activeTheme() {
    if (TABLE) return TABLE.theme;
    if (remoteState && remoteState.theme) return remoteState.theme;
    return selectedTheme;
  }

  function applyTheme() {
    const id = activeTheme();
    const t = SNLThemes.get(id);
    const root = document.documentElement.style;
    root.setProperty('--accent', t.accent);
    root.setProperty('--accent-dim', t.accentDim);
    root.setProperty('--accent-text', t.accentText);
    document.getElementById('themeIcon').textContent = t.icon;
    document.getElementById('themeTitle').textContent = t.title;
    document.title = t.title;
    els.rollBtn.textContent = t.roll;
    if (!gameStarted) els.boardHint.textContent = t.hint;
    themeOptionsEl.querySelectorAll('.theme-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === id);
      b.disabled = mode === 'client';
    });
    document.getElementById('themePickerLabel').textContent = mode === 'client' ? "Board theme (the host's pick)" : 'Choose a board theme';
  }
  applyTheme();

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
        SNL.setTheme(TABLE, selectedTheme, SNLThemes.get(selectedTheme).colors);
        SNL.addPlayer(TABLE, myId, els.hostName.value.trim() || 'Player 1', false);
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
    SNL.addPlayer(TABLE, 'bot-' + botCounter, SNLThemes.get(TABLE.theme).botNames[TABLE.players.length] + ' (CPU)', true);
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
        applyTheme(); // lock the picker - the host chooses
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
      const prevTheme = remoteState && remoteState.theme;
      remoteState = data.state;
      if (remoteState.theme !== prevTheme) applyTheme();
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
    const theme = SNLThemes.get(selectedTheme);
    SNL.setTheme(TABLE, selectedTheme, theme.colors);
    SNL.addPlayer(TABLE, myId, 'You', false);
    const n = Number(els.botCount.value);
    for (let i = 1; i <= n; i++) SNL.addPlayer(TABLE, 'bot-' + i, theme.botNames[i] + ' (CPU)', true);
    applyTheme();
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
      }, SNLRender.remainingMs(performance.now()) + 700 + Math.random() * 500);
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
    if (!myTurn(state) || animating) return;
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
      els.turnStatus.textContent = `${SNLThemes.get(activeTheme()).icon} ${SNLThemes.get(activeTheme()).win.replace('{name}', w ? w.name : 'Someone')}`;
    } else if (opponentGone) {
      els.turnStatus.textContent = 'Connection lost.';
    } else if (acting) {
      els.turnStatus.textContent = acting.id === myId ? 'Your roll!' : `${acting.name}'s turn...`;
    } else {
      els.turnStatus.textContent = 'Waiting...';
    }

    const iRoll = myTurn(state);
    els.rollBtn.disabled = !iRoll || state.stage !== 'playing' || animating;
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

  // ---------- canvas rendering (see render.js) ----------
  function render() {
    SNLRender.draw(ctx, currentState(), myId, performance.now(), activeTheme());
  }

  // keeps snake tongues and move animations running; unlocks the roll
  // button once a move has finished playing out
  function loop(now) {
    render();
    const busy = SNLRender.remainingMs(now) > 0;
    if (busy !== animating) { animating = busy; if (gameStarted) updateHUD(); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__SNL_DEBUG = { getState: currentState, getTable: () => TABLE, getMode: () => mode, getMyId: () => myId };
})();
