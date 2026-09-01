(function () {
  const canvas = document.getElementById('tableCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

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

  render(); // draw the empty table immediately, before any game starts

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
        TABLE = PK.newTable();
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
        <span class="bot-tag">${p.isBot ? 'Computer &middot; ' : ''}${p.chips} chips</span>
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
      PokerNet.sendTo(id, { type: 'state', state: PK.serializeFor(TABLE, id) });
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
    TABLE = PK.newTable();
    PK.addPlayer(TABLE, myId, 'You', false);
    const n = Number(els.botCount.value);
    for (let i = 1; i <= n; i++) PK.addPlayer(TABLE, 'bot-' + i, 'Computer ' + i, true);
    startGameUI();
    PK.dealHand(TABLE);
    hostProcessTurn();
  });

  // ---------- shared game flow ----------
  function startGameUI() {
    gameStarted = true;
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

  // host/practice: after every state mutation, check whether a bot needs to
  // act next (recursing through the whole chain), or the hand ended.
  function hostProcessTurn() {
    if (!TABLE) return;
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
        PK.applyAction(TABLE, actor.id, action);
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
    }, 4500);
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
    els.raiseAmount.textContent = els.raiseSlider.value;
    els.raiseRow.hidden = false;
  }
  els.raiseSlider.addEventListener('input', () => { els.raiseAmount.textContent = els.raiseSlider.value; });

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
    els.potInfo.textContent = `Pot: ${state.pot}`;

    const me = state.players.find(p => p.id === myId);
    const acting = state.players.find(p => p.id === state.actingId);
    if (state.stage === 'showdown' && state.winners.length) {
      els.turnStatus.textContent = state.winners.map(w => `${w.name} +${w.amount}${w.handName ? ' (' + w.handName + ')' : ''}`).join(', ');
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
    if (iAct) els.checkCallBtn.textContent = legal.canCheck ? 'Check' : `Call ${legal.callAmount}`;
    if (!iAct) closeRaiseRow();
    els.betRaiseBtn.textContent = state.currentBet > 0 ? 'Raise' : 'Bet';

    const logLines = state.log.slice(-10);
    els.log.innerHTML = logLines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    els.log.scrollTop = els.log.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- canvas rendering ----------
  function seatPositions(n) {
    const cx = W / 2, cy = H / 2 - 10, rx = 370, ry = 205;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const angle = Math.PI / 2 + k * (2 * Math.PI / n);
      pts.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), angle });
    }
    return pts;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function suitSymbol(s) { return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || '?'; }

  function drawCard(x, y, w, h, card, faceDown) {
    roundRect(ctx, x, y, w, h, 6);
    if (faceDown || !card) {
      ctx.fillStyle = faceDown ? '#1c3a5e' : 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (faceDown) {
        ctx.save();
        roundRect(ctx, x, y, w, h, 6);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        for (let i = -h; i < w + h; i += 7) {
          ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h); ctx.stroke();
        }
        ctx.restore();
      }
      return;
    }
    ctx.fillStyle = '#fdfdfd';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const red = card.suit === 'H' || card.suit === 'D';
    ctx.fillStyle = red ? '#d0263a' : '#1a1a1a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(h * 0.3)}px sans-serif`;
    ctx.fillText(PK.rankLabel(card.rank), x + 4, y + 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.34)}px sans-serif`;
    ctx.fillText(suitSymbol(card.suit), x + w / 2, y + h / 2 + h * 0.08);
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  function drawChipStack(x, y, amount, color) {
    if (!amount) return;
    const layers = Math.min(5, 1 + Math.floor(amount / 60));
    for (let i = 0; i < layers; i++) {
      ctx.beginPath();
      ctx.ellipse(x, y - i * 3, 10, 5.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? color : shade(color, -25);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(amount, x, y - layers * 3 - 8);
  }

  function render() {
    const state = currentState();
    ctx.clearRect(0, 0, W, H);

    // backdrop
    const bg = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 620);
    bg.addColorStop(0, '#132018');
    bg.addColorStop(1, '#0a0f0c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // rail
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2 - 10, 410, 245, 0, 0, Math.PI * 2);
    const railGrad = ctx.createLinearGradient(0, H / 2 - 255, 0, H / 2 + 225);
    railGrad.addColorStop(0, '#6b4527');
    railGrad.addColorStop(1, '#3a230f');
    ctx.fillStyle = railGrad;
    ctx.fill();
    ctx.restore();

    // felt
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2 - 10, 370, 205, 0, 0, Math.PI * 2);
    const felt = ctx.createRadialGradient(W / 2, H / 2 - 10, 40, W / 2, H / 2 - 10, 380);
    felt.addColorStop(0, '#0f6b48');
    felt.addColorStop(1, '#083f2b');
    ctx.fillStyle = felt;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    if (!state) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for players...', W / 2, H / 2);
      return;
    }

    const n = state.players.length;
    if (!n) return;
    const mySeat = (state.players.find(p => p.id === myId) || {}).seat || 0;
    const positions = seatPositions(n);

    // community cards + pot (center)
    const cardW = 44, cardH = 62, gap = 8;
    const totalW = cardW * 5 + gap * 4;
    const startX = W / 2 - totalW / 2;
    for (let i = 0; i < 5; i++) {
      const card = state.community[i];
      drawCard(startX + i * (cardW + gap), H / 2 - 10 - cardH / 2, cardW, cardH, card, false);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Pot: ${state.pot}`, W / 2, H / 2 - 10 - cardH / 2 - 16);

    // seats
    state.players.forEach((p) => {
      const displayIdx = (p.seat - mySeat + n) % n;
      const pos = positions[displayIdx];
      const color = SEAT_COLORS[p.seat % SEAT_COLORS.length];
      const isActing = state.actingId === p.id;
      const isMe = p.id === myId;

      ctx.save();
      ctx.globalAlpha = p.folded || p.bustedOut ? 0.4 : 1;

      // hole cards
      const cw = isMe ? 40 : 30, ch = isMe ? 58 : 44;
      const showFace = isMe || state.stage === 'showdown';
      const cardsY = pos.y - ch - 34;
      if (p.holeCards && p.holeCards.length && !p.bustedOut) {
        drawCard(pos.x - cw - 2, cardsY, cw, ch, p.holeCards[0], !showFace);
        drawCard(pos.x + 2, cardsY, cw, ch, p.holeCards[1], !showFace);
      }

      // avatar
      const r = isMe ? 30 : 26;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (isActing) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fff2a8';
        ctx.shadowColor = '#fff2a8';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();
      }
      ctx.fillStyle = '#0f1720';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((p.name || '?').slice(0, 2).toUpperCase(), pos.x, pos.y);

      // name / chips label
      ctx.globalAlpha = p.folded || p.bustedOut ? 0.55 : 1;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(p.name + (isMe ? ' (you)' : ''), pos.x, pos.y + r + 16);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '11px sans-serif';
      ctx.fillText(p.bustedOut ? 'out' : p.folded ? 'folded' : `${p.chips} chips`, pos.x, pos.y + r + 30);

      // dealer button
      if (p.seat === state.dealerSeat) {
        ctx.beginPath();
        ctx.arc(pos.x + r + 6, pos.y - r - 6, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('D', pos.x + r + 6, pos.y - r - 5);
      }

      ctx.restore();

      // bet-this-round chips, well clear of the seat's name/chip labels
      // (which sit below the avatar) - push firmly toward the pot
      if (p.betThisRound > 0 && !p.bustedOut) {
        const bx = pos.x + (W / 2 - pos.x) * 0.55;
        const by = pos.y + (H / 2 - 10 - pos.y) * 0.55;
        drawChipStack(bx, by, p.betThisRound, color);
      }
    });

    // winner banner
    if (state.stage === 'showdown' && state.winners.length) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, W / 2 - 200, 14, 400, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#fff2a8';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.winners.map(w => `${w.name} +${w.amount}`).join('  •  '), W / 2, 34);
    }
  }

  // periodic light refresh for the "thinking" indicator / anything time-based
  setInterval(() => { if (gameStarted) { render(); } }, 900);

  window.__PK_DEBUG = { getState: currentState, getTable: () => TABLE, getMode: () => mode, getMyId: () => myId };
})();
