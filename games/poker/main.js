(function () {
  const canvas = document.getElementById('tableCanvas');
  const ctx = PokerRender.init(canvas);

  const SEAT_COLORS = ['#4fd1c5', '#f6ad55', '#e05263', '#a78bfa', '#f4d35e', '#66bb6a'];

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
    handStatus: document.getElementById('handStatus'),
    turnStatus: document.getElementById('turnStatus'),
    log: document.getElementById('log'),
    leaveBtn: document.getElementById('leaveBtn'),
    actionBar: document.getElementById('actionBar'),
    potInfo: document.getElementById('potInfo'),
    foldBtn: document.getElementById('foldBtn'),
    checkCallBtn: document.getElementById('checkCallBtn'),
    betRaiseBtn: document.getElementById('betRaiseBtn'),
    raiseRow: document.getElementById('raiseRow'),
    raiseSlider: document.getElementById('raiseSlider'),
    raiseAmount: document.getElementById('raiseAmount'),
    quickHalfPot: document.getElementById('quickHalfPot'),
    quickPot: document.getElementById('quickPot'),
    quickAllIn: document.getElementById('quickAllIn'),
    tableHint: document.getElementById('tableHint')
  };

  let mode = null;          // 'practice' | 'host' | 'client'
  let myId = null;
  let TABLE = null;          // authoritative PK table - host/practice only
  let remoteState = null;    // latest personalized state - client only
  let opponentGone = false;
  let botCounter = 0;
  let gameStarted = false;
  let hostTurnTimer = null;
  let lastFrame = 0, animating = false; // render loop bookkeeping

  // ---------- rooms (stakes + theme) ----------
  // Every room plays the same game; the starting stack, blinds, table,
  // cards and page colours change. The host's room travels in the state.
  const roomStore = {
    get() { try { return localStorage.getItem('poker.room'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('poker.room', v); } catch (e) { /* ignore */ } }
  };
  let selectedRoom = PokerRooms.get(roomStore.get()).id;
  let shownRoom = null;
  const inr = PokerRooms.inr;
  const METAL_HEX = { gold: '#e9c25a', rose: '#eea683', silver: '#d5dce4', ice: '#7fd0ff' };

  function roomTiles() {
    const tile = (r) => {
      const f = r.table.felt;
      return `<button type="button" class="room-tile" data-room="${r.id}"
        style="--tile-bg:radial-gradient(circle at 30% 20%, ${f[0]}, ${f[2]} 80%); --tile-accent:${r.ui.accent}">
        <span class="ri">${r.icon}</span><b>${r.name}</b>
        <span class="buyin">${inr(r.start, true)}</span>
        <span class="blinds">Blinds ${inr(r.smallBlind, true)}/${inr(r.bigBlind, true)}</span></button>`;
    };
    document.getElementById('roomsGrid').innerHTML = PokerRooms.list.filter(r => r.section === 'rooms').map(tile).join('');
    document.getElementById('highGrid').innerHTML = PokerRooms.list.filter(r => r.section === 'high').map(tile).join('');
    document.querySelector('.room-picker').addEventListener('click', (e) => {
      const b = e.target.closest('.room-tile');
      if (!b || b.disabled) return;
      selectedRoom = b.dataset.room;
      roomStore.set(selectedRoom);
      applyRoom(selectedRoom);
    });
  }

  function activeRoom() {
    if (TABLE) return TABLE.room;
    if (remoteState && remoteState.room) return remoteState.room;
    return selectedRoom;
  }

  // restyle the whole page for a room
  function applyRoom(id) {
    const r = PokerRooms.get(id);
    const st = document.documentElement.style, u = r.ui;
    st.setProperty('--bg', u.bg); st.setProperty('--bg2', u.bg2);
    st.setProperty('--panel', u.panel); st.setProperty('--panel-2', u.panel2);
    st.setProperty('--border', u.border); st.setProperty('--accent', u.accent);
    st.setProperty('--accent-text', u.accentText); st.setProperty('--muted', u.muted);
    const cf = r.cards.face;
    st.setProperty('--mc-face1', cf[0]); st.setProperty('--mc-face2', cf[2]);
    st.setProperty('--mc-edge', r.cards.edge);
    st.setProperty('--mc-black', METAL_HEX[r.cards.ink.black] || r.cards.ink.black);
    st.setProperty('--mc-red', METAL_HEX[r.cards.ink.red] || r.cards.ink.red);
    document.body.classList.toggle('serif', !!u.serif);
    document.getElementById('roomIcon').textContent = r.icon;
    document.getElementById('roomTitle').textContent = '· ' + r.name;
    document.title = `IR Hold'em · ${r.name}`;
    document.querySelectorAll('.room-tile').forEach(b => {
      b.classList.toggle('active', b.dataset.room === r.id);
      b.disabled = !!mode;
    });
    document.getElementById('roomNote').textContent = mode === 'client'
      ? `Playing in the host's room: ${r.name} (${r.tagline})`
      : `${r.name}: ${r.tagline}. Everyone starts with ${inr(r.start)}.`;
    shownRoom = r.id;
    PokerRender.setRoom(r.id);
    if (typeof render === 'function') render();
  }

  function roomTable() {
    const r = PokerRooms.get(selectedRoom);
    return PK.newTable({ room: r.id, startChips: r.start, smallBlind: r.smallBlind, bigBlind: r.bigBlind });
  }

  roomTiles();
  applyRoom(selectedRoom);
  render(); // draw the empty table immediately, before any game starts

  // ---------- hand rankings cheat sheet ----------
  // Docked beside the table on wide screens; a slide-over drawer otherwise.
  const rankingsEl = document.getElementById('rankings');
  const rankingsToggle = document.getElementById('rankingsToggle');
  PokerRankings.mount(rankingsEl);
  function setRankingsOpen(open) {
    document.body.classList.toggle('rankings-open', open);
    rankingsToggle.classList.toggle('active', open);
  }
  rankingsToggle.addEventListener('click', () => {
    const wide = window.matchMedia('(min-width: 1200px) and (min-aspect-ratio: 6/5)').matches;
    if (wide) document.body.classList.toggle('rankings-hidden');
    else setRankingsOpen(!document.body.classList.contains('rankings-open'));
  });
  rankingsEl.querySelector('.rk-close').addEventListener('click', () => {
    setRankingsOpen(false);
    document.body.classList.add('rankings-hidden');
  });

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
    PokerNet.onData = handleHostData;
    PokerNet.onGuestLeft = (peerId) => {
      if (!TABLE) return;
      PK.removePlayer(TABLE, peerId);
      renderLobbyOrBroadcast();
    };
    PokerNet.hostGame(
      (code) => {
        mode = 'host';
        myId = code;
        TABLE = roomTable();
        applyRoom(TABLE.room); // locks the picker - the room is set for this table
        PK.addPlayer(TABLE, myId, els.hostName.value.trim() || 'Player 1', false);
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
    if (!TABLE || TABLE.players.length >= PK.MAX_SEATS) return;
    botCounter += 1;
    PK.addPlayer(TABLE, 'bot-' + botCounter, 'Computer ' + botCounter, true);
    renderLobbyOrBroadcast();
  });

  els.startTableBtn.addEventListener('click', () => {
    if (!TABLE || TABLE.players.length < 2) return;
    startGameUI();
    PK.dealHand(TABLE);
    hostProcessTurn();
  });

  function renderLobbyOrBroadcast() {
    if (!TABLE) return;
    els.lobbyCount.textContent = TABLE.players.length;
    els.lobbyList.innerHTML = TABLE.players.map(p => `
      <div class="lobby-row">
        <span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
        <span class="bot-tag">${p.isBot ? 'Computer &middot; ' : ''}${PK.rupees(p.chips)}</span>
      </div>`).join('');
    els.startTableBtn.disabled = TABLE.players.length < 2;
    els.addBotBtn.disabled = TABLE.players.length >= PK.MAX_SEATS;
    if (mode === 'host') broadcastPersonalized();
  }

  function handleHostData(data, fromPeerId) {
    if (data.type === 'hello') {
      PK.addPlayer(TABLE, fromPeerId, (data.name || '').trim() || 'Player', false);
      renderLobbyOrBroadcast();
    } else if (data.type === 'action') {
      if (!TABLE || TABLE.actingId !== fromPeerId) return;
      const ok = PK.applyAction(TABLE, fromPeerId, { kind: data.kind, amount: data.amount });
      if (ok) hostProcessTurn();
    } else if (data.type === 'leave') {
      if (TABLE) { PK.removePlayer(TABLE, fromPeerId); renderLobbyOrBroadcast(); if (gameStarted) hostProcessTurn(); }
    }
  }

  function broadcastPersonalized() {
    if (!TABLE) return;
    for (const id of PokerNet.conns.keys()) {
      PokerNet.sendTo(id, { type: 'state', state: PK.serializeFor(TABLE, id), turnMsLeft: msLeft() });
    }
  }

  // ---------- join flow ----------
  els.joinBtn.addEventListener('click', () => {
    const code = els.joinCode.value.trim().toUpperCase();
    if (!code) return;
    els.joinBtn.disabled = true;
    els.joinBtn.textContent = 'Connecting...';
    PokerNet.onData = handleGuestData;
    PokerNet.onClose = () => handleOpponentGone();
    PokerNet.joinGame(
      code,
      () => {
        mode = 'client';
        applyRoom(activeRoom()); // the host picks the room
        myId = PokerNet.myId;
        PokerNet.sendToHost({ type: 'hello', name: els.joinName.value.trim() || 'Player' });
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
      remoteState = data.state;
      // re-sync the countdown from the host (clocks on different devices differ)
      guestDeadline = data.turnMsLeft ? performance.now() + data.turnMsLeft : 0;
      if (remoteState.room && remoteState.room !== shownRoom) applyRoom(remoteState.room);
      if (remoteState.stage === 'waiting') {
        els.joinStatusMsg.textContent = `Waiting for the host to start... (${remoteState.players.length} seated)`;
      } else if (!gameStarted) {
        startGameUI();
      }
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
    TABLE = roomTable();
    applyRoom(TABLE.room);
    PK.addPlayer(TABLE, myId, 'You', false);
    const n = Number(els.botCount.value);
    for (let i = 1; i <= n; i++) PK.addPlayer(TABLE, 'bot-' + i, 'Computer ' + i, true);
    startGameUI();
    PK.dealHand(TABLE);
    hostProcessTurn();
  });

  // ---------- shared game flow ----------
  // phones: the game log folds away behind a button
  const logToggle = document.getElementById('logToggle');
  logToggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('log-open');
    logToggle.setAttribute('aria-expanded', open);
    logToggle.textContent = open ? 'Log ▴' : 'Log ▾';
  });

  function startGameUI() {
    gameStarted = true;
    document.body.classList.add('in-game');
    els.setupPanel.hidden = true;
    els.gamePanel.hidden = false;
    els.actionBar.hidden = false;
    els.tableHint.textContent = 'Good luck!';
  }

  function isAuthority() { return mode === 'practice' || mode === 'host'; }

  function currentState() {
    if (isAuthority()) return TABLE ? PK.serializeFor(TABLE, myId) : null;
    return remoteState;
  }

  // ---------- 30-second turn timer ----------
  // The authority (host / practice) owns the clock. Each new turn of a human
  // player gets TURN_MS; when it runs out they check if they can, else fold.
  // Guests get the time left with every state update.
  const TURN_MS = 30000;
  let turnKey = null, turnDeadline = 0;   // authority: which turn is running, and when it ends
  let guestDeadline = 0, guestKey = null; // guest: local deadline from the host's "ms left"
  function turnKeyOf(t) { return t && t.actingId && t.stage !== 'showdown' ? `${t.handNumber}|${t.actingId}|${t.log.length}` : null; }
  function armTurnTimer() {
    const key = turnKeyOf(TABLE);
    if (key === turnKey) return;
    turnKey = key;
    const actor = key && TABLE.players.find(p => p.id === TABLE.actingId);
    turnDeadline = actor && !actor.isBot ? performance.now() + TURN_MS : 0;
  }
  function msLeft() {
    if (isAuthority()) return turnDeadline ? Math.max(0, turnDeadline - performance.now()) : 0;
    return guestDeadline ? Math.max(0, guestDeadline - performance.now()) : 0;
  }
  // time's up: check if possible, otherwise fold
  setInterval(() => {
    if (!isAuthority() || !TABLE || !turnDeadline || performance.now() < turnDeadline) return;
    const id = TABLE.actingId, p = TABLE.players.find(x => x.id === id);
    turnDeadline = 0;
    if (!p || p.isBot) return;
    const legal = PK.legalActions(TABLE, id);
    PK.addLog(TABLE, `⏱ ${p.name === 'You' ? 'You ran' : p.name + ' ran'} out of time.`);
    const ok = legal && legal.canCheck ? PK.applyAction(TABLE, id, { kind: 'check' }) : PK.applyAction(TABLE, id, { kind: 'fold' });
    if (ok) {
      if (id === myId) closeRaiseRow();
      hostProcessTurn();
    }
  }, 200);
  // last-5-seconds tick (only on your own turn)
  let lastTickSec = -1, tickCtx = null;
  function tick(final) {
    try {
      tickCtx = tickCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = tickCtx.createOscillator(), g = tickCtx.createGain(), t = tickCtx.currentTime;
      o.frequency.value = final ? 520 : 880; o.type = 'triangle';
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(tickCtx.destination); o.start(t); o.stop(t + 0.13);
    } catch (e) { /* no audio */ }
  }
  setInterval(() => {
    const st = currentState();
    const mine = st && st.actingId === myId && st.stage !== 'showdown';
    const left = msLeft();
    if (!mine || !left) { lastTickSec = -1; updateTimerLabel(); return; }
    const sec = Math.ceil(left / 1000);
    if (sec <= 5 && sec !== lastTickSec) { tick(sec === 1); lastTickSec = sec; }
    updateTimerLabel();
  }, 250);
  function updateTimerLabel() {
    const el = document.getElementById('turnTimer');
    const st = currentState();
    const left = msLeft();
    const mine = st && st.actingId === myId && st.stage !== 'showdown' && left > 0;
    el.hidden = !mine;
    if (!mine) return;
    const sec = Math.ceil(left / 1000);
    el.textContent = `⏱ ${sec}s`;
    el.classList.toggle('warn', sec <= 10);
  }

  // host/practice: after every state mutation, check whether a bot needs to
  // act next (recursing through the whole chain), or the hand ended.
  function hostProcessTurn() {
    if (!TABLE) return;
    armTurnTimer();
    broadcastPersonalized();
    render();
    updateHUD();
    clearTimeout(hostTurnTimer);

    if (TABLE.stage === 'showdown') {
      scheduleNextHand();
      return;
    }
    const actor = TABLE.players.find(p => p.id === TABLE.actingId);
    if (actor && actor.isBot) {
      hostTurnTimer = setTimeout(() => {
        if (!TABLE || TABLE.stage === 'showdown' || TABLE.actingId !== actor.id) return;
        const action = PK.botAction(TABLE, actor.id);
        // never let a rejected move stall the table: fall back to something legal
        if (!PK.applyAction(TABLE, actor.id, action)) {
          PK.applyAction(TABLE, actor.id, { kind: 'call' }) || PK.applyAction(TABLE, actor.id, { kind: 'check' }) || PK.applyAction(TABLE, actor.id, { kind: 'fold' });
        }
        hostProcessTurn();
      }, 650 + Math.random() * 700);
    }
  }

  function scheduleNextHand() {
    const remaining = TABLE.players.filter(p => !p.bustedOut);
    if (remaining.length < 2) {
      PK.addLog(TABLE, remaining.length === 1 ? `🏆 ${remaining[0].name} wins the whole game!` : 'Game over.');
      broadcastPersonalized();
      render();
      updateHUD();
      return;
    }
    hostTurnTimer = setTimeout(() => {
      if (!TABLE) return;
      PK.dealHand(TABLE);
      hostProcessTurn();
    }, TABLE.winners.some(w => w.handName) ? 7000 : 4000); // a real showdown gets time to show the winning hand
  }

  function submitAction(action) {
    if (mode === 'client') {
      PokerNet.sendToHost({ type: 'action', kind: action.kind, amount: action.amount });
    } else if (TABLE) {
      const ok = PK.applyAction(TABLE, myId, action);
      if (ok) hostProcessTurn();
    }
  }

  function deriveLegal(state) {
    if (!state || state.actingId !== myId) return null;
    return PK.legalActions(
      { players: state.players, currentBet: state.currentBet, minRaise: state.minRaise, actingId: state.actingId },
      myId
    );
  }

  // ---------- betting controls ----------
  function closeRaiseRow() { els.raiseRow.hidden = true; }
  function openRaiseRow(legal) {
    const min = legal.minRaiseTo, max = Math.max(min, legal.maxRaiseTo);
    els.raiseSlider.min = min;
    els.raiseSlider.max = max;
    els.raiseSlider.value = Math.min(max, min);
    els.raiseAmount.textContent = PK.rupees(els.raiseSlider.value);
    els.raiseRow.hidden = false;
  }
  els.raiseSlider.addEventListener('input', () => { els.raiseAmount.textContent = PK.rupees(els.raiseSlider.value); });

  els.foldBtn.addEventListener('click', () => { submitAction({ kind: 'fold' }); closeRaiseRow(); });
  els.checkCallBtn.addEventListener('click', () => {
    const state = currentState();
    const legal = deriveLegal(state);
    if (!legal) return;
    submitAction({ kind: legal.canCheck ? 'check' : 'call' });
    closeRaiseRow();
  });
  els.betRaiseBtn.addEventListener('click', () => {
    const state = currentState();
    const legal = deriveLegal(state);
    if (!legal) return;
    if (els.raiseRow.hidden) {
      openRaiseRow(legal);
    } else {
      submitAction({ kind: state.currentBet > 0 ? 'raise' : 'bet', amount: Number(els.raiseSlider.value) });
      closeRaiseRow();
    }
  });
  function quickSubmit(getAmount) {
    const state = currentState();
    const legal = deriveLegal(state);
    if (!legal) return;
    const amount = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, getAmount(state, legal)));
    submitAction({ kind: state.currentBet > 0 ? 'raise' : 'bet', amount });
    closeRaiseRow();
  }
  els.quickHalfPot.addEventListener('click', () => quickSubmit((s, l) => s.currentBet + Math.floor((s.pot || s.bigBlind) * 0.5)));
  els.quickPot.addEventListener('click', () => quickSubmit((s, l) => s.currentBet + (s.pot || s.bigBlind)));
  els.quickAllIn.addEventListener('click', () => quickSubmit((s, l) => l.maxRaiseTo));

  function handleOpponentGone() {
    opponentGone = true;
    els.turnStatus.textContent = 'Lost connection to the host.';
  }

  els.leaveBtn.addEventListener('click', () => {
    if (mode === 'host' || mode === 'client') {
      if (mode === 'client') PokerNet.sendToHost({ type: 'leave' });
      PokerNet.teardown();
    }
    clearTimeout(hostTurnTimer);
    location.reload();
  });

  window.addEventListener('beforeunload', () => {
    if (mode === 'client') PokerNet.sendToHost({ type: 'leave' });
  });

  // ---------- HUD ----------
  function updateHUD() {
    const state = currentState();
    if (!state) return;
    els.handStatus.textContent = `Hand #${state.handNumber}`;
    els.potInfo.textContent = `Pot: ${PK.rupees(state.pot)}`;

    const me = state.players.find(p => p.id === myId);
    const acting = state.players.find(p => p.id === state.actingId);
    if (state.stage === 'showdown' && state.winners.length) {
      els.turnStatus.textContent = state.winners.map(w => `${w.name} +${PK.rupees(w.amount)}${w.handName ? ' (' + w.handName + ')' : ''}`).join(', ');
    } else if (opponentGone) {
      els.turnStatus.textContent = 'Connection lost.';
    } else if (acting) {
      els.turnStatus.textContent = acting.id === myId ? "Your turn!" : `${acting.name} is thinking...`;
    } else {
      els.turnStatus.textContent = 'Dealing...';
    }

    const legal = deriveLegal(state);
    const iAct = !!legal;
    els.actionBar.style.opacity = iAct ? '1' : '0.5';
    els.foldBtn.disabled = !iAct;
    els.checkCallBtn.disabled = !iAct;
    els.betRaiseBtn.disabled = !iAct || (legal && !legal.canBetOrRaise);
    if (iAct) els.checkCallBtn.textContent = legal.canCheck ? 'Check' : `Call ${PK.rupees(legal.callAmount)}`;
    if (!iAct) closeRaiseRow();
    els.betRaiseBtn.textContent = state.currentBet > 0 ? 'Raise' : 'Bet';

    const myCards = me && !me.folded && me.holeCards && me.holeCards[0]
      ? me.holeCards.concat(state.community)
      : null;
    PokerRankings.highlight(rankingsEl, myCards);

    const logLines = state.log.slice(-10);
    els.log.innerHTML = logLines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    els.log.scrollTop = els.log.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- canvas rendering (see render.js) ----------
  // Redraws immediately on state changes; the loop below keeps animations
  // (dealing, chip movement, the acting player's glow) running smoothly.
  function render() {
    lastFrame = performance.now();
    const st = currentState();
    if (st) st.turnTimer = { left: msLeft(), total: TURN_MS };
    animating = PokerRender.draw(ctx, st, myId, SEAT_COLORS, lastFrame);
  }

  function loop(now) {
    if (animating || now - lastFrame > 500) render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- zoom: pinch, double-tap, drag to pan, wheel, buttons ----------
  (function zoomInput() {
    const pts = new Map();
    let pinch = null, lastTap = { t: 0, x: 0, y: 0 }, moved = false;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const centre = () => { const r = canvas.getBoundingClientRect(); return { x: r.width / 2, y: r.height / 2 }; };
    const sync = () => { document.getElementById('zoomOut').disabled = PokerRender.getZoom() <= 1.01; animating = true; };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      moved = false;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: PokerRender.getZoom() };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId), cur = local(e);
      pts.set(e.pointerId, cur);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        PokerRender.zoomTo(pinch.z * d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2, true);
        moved = true; sync();
      } else if (pts.size === 1 && PokerRender.getZoom() > 1.01) {
        const dx = cur.x - prev.x, dy = cur.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) { PokerRender.panBy(dx, dy); moved = true; sync(); }
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (moved || pts.size) return;
      // double tap: zoom in there, or back out
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        PokerRender.zoomTo(PokerRender.getZoom() > 1.05 ? 1 : 2.2, p.x, p.y);
        lastTap.t = 0; sync();
      } else lastTap = { t: now, x: p.x, y: p.y };
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      PokerRender.zoomTo(PokerRender.getZoom() * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
      sync();
    }, { passive: false });
    document.getElementById('zoomIn').onclick = () => { const c = centre(); PokerRender.zoomTo(PokerRender.getZoom() * 1.4, c.x, c.y); sync(); };
    document.getElementById('zoomOut').onclick = () => { const c = centre(); PokerRender.zoomTo(PokerRender.getZoom() / 1.4, c.x, c.y); sync(); };
    // jump straight to your own cards (and back)
    document.getElementById('zoomMe').onclick = () => {
      if (PokerRender.getZoom() > 1.05) { PokerRender.zoomTo(1, 0, 0); sync(); return; }
      const r = canvas.getBoundingClientRect();
      PokerRender.zoomCentre(1.8, r.width / 2, r.height * (r.height > r.width ? 0.8 : 0.72));
      sync();
    };
    sync();
  })();

  // The canvas fills its container - refit the table when that changes.
  // One observer for the page's lifetime; the resize waits until the layout
  // has settled (e.g. after opening/closing Hand Rankings) and is skipped
  // when the size didn't really change - the browser just stretches the
  // current frame in the meantime.
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (PokerRender.resize()) render(); }, 140);
  }).observe(canvas);

  window.__PK_DEBUG = { msLeft, expireTurn: () => { if (turnDeadline) turnDeadline = performance.now() - 1; }, getState: currentState, getTable: () => TABLE, getMode: () => mode, getMyId: () => myId };
})();
