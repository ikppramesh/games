(function () {
  const canvas = document.getElementById('tableCanvas');
  SB.init(canvas);
  SB.render({ myTurn: false }); // draw the empty table immediately, before any game starts

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
    cpuBtn: document.getElementById('cpuBtn'),
    difficulty: document.getElementById('difficulty'),
    roomCodeBox: document.getElementById('roomCodeBox'),
    roomCodeText: document.getElementById('roomCodeText'),
    roomLink: document.getElementById('roomLink'),
    copyLinkBtn: document.getElementById('copyLinkBtn'),
    hostStatusMsg: document.getElementById('hostStatusMsg'),
    p1NameEl: document.getElementById('p1NameEl'),
    p2NameEl: document.getElementById('p2NameEl'),
    p1ScoreEl: document.getElementById('p1ScoreEl'),
    p2ScoreEl: document.getElementById('p2ScoreEl'),
    p1Card: document.getElementById('p1Card'),
    p2Card: document.getElementById('p2Card'),
    roundLabel: document.getElementById('roundLabel'),
    pucksLeftLabel: document.getElementById('pucksLeftLabel'),
    turnStatus: document.getElementById('turnStatus'),
    laneLeftBtn: document.getElementById('laneLeftBtn'),
    laneRightBtn: document.getElementById('laneRightBtn'),
    log: document.getElementById('log'),
    leaveBtn: document.getElementById('leaveBtn')
  };

  let mode = null; // 'practice' (pass & play) | 'cpu' (vs computer) | 'host' | 'client'
  let cpuLevel = 'medium';
  let botTurn = null; // the computer's shot in progress: {phase, start, plan, fromX}
  let opponentLeft = false;
  let inputAttached = false;
  let frameCount = 0;
  let lastTs = null;

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

  // prefill room code from a shared link (?room=CODE)
  const params = new URLSearchParams(location.search);
  const sharedRoom = params.get('room');
  if (sharedRoom) {
    document.querySelector('.tab-btn[data-tab="join"]').click();
    els.joinCode.value = sharedRoom.toUpperCase();
  }

  // ---------- host flow ----------
  els.createBtn.addEventListener('click', () => {
    els.createBtn.disabled = true;
    els.createBtn.textContent = 'Creating room...';
    Net.onData = handleHostData;
    Net.hostGame(
      (code) => {
        mode = 'host';
        els.createBtn.textContent = 'Room Created';
        els.roomCodeBox.hidden = false;
        els.roomCodeText.textContent = code;
        const link = `${location.origin}${location.pathname}?room=${code}`;
        els.roomLink.value = link;
        els.hostStatusMsg.textContent = 'Waiting for your opponent to join...';
      },
      (err) => {
        els.createBtn.disabled = false;
        els.createBtn.textContent = 'Create Room';
        els.hostStatusMsg.textContent = 'Could not create room: ' + (err.message || err.type || err);
      }
    );
  });

  els.copyLinkBtn.addEventListener('click', () => {
    els.roomLink.select();
    navigator.clipboard?.writeText(els.roomLink.value).catch(() => {
      document.execCommand('copy');
    });
    els.copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { els.copyLinkBtn.textContent = 'Copy'; }, 1200);
  });

  Net.onGuestConnected = () => {
    els.hostStatusMsg.textContent = 'Opponent connected! Waiting for them to be ready...';
  };

  function handleHostData(data) {
    if (data.type === 'hello') {
      SB.resetMatch(els.hostName.value.trim() || 'Player 1', (data.name || '').trim() || 'Player 2');
      Net.send({ type: 'start', p1Name: SB.state.p1Name, p2Name: SB.state.p2Name });
      startGameUI();
      broadcastState();
    } else if (data.type === 'shoot') {
      if (SB.state.currentShooter === 2 && !SB.state.simulating && !SB.state.matchOver) {
        SB.shoot({ angle: data.angle, power: data.power });
        broadcastState();
      }
    } else if (data.type === 'nudge') {
      if (SB.state.currentShooter === 2 && !SB.state.simulating) {
        SB.nudgeLane(2, data.dir);
        broadcastState();
      }
    } else if (data.type === 'leave') {
      handleOpponentLeft();
    }
  }

  function broadcastState() {
    Net.send({ type: 'state', state: SB.serializeState() });
  }

  // ---------- join flow ----------
  els.joinBtn.addEventListener('click', () => {
    const code = els.joinCode.value.trim().toUpperCase();
    if (!code) return;
    els.joinBtn.disabled = true;
    els.joinBtn.textContent = 'Connecting...';
    Net.onData = handleGuestData;
    Net.joinGame(
      code,
      () => {
        mode = 'client';
        Net.send({ type: 'hello', name: els.joinName.value.trim() || 'Player 2' });
        els.joinBtn.textContent = 'Connected, waiting for host...';
      },
      (err) => {
        els.joinBtn.disabled = false;
        els.joinBtn.textContent = 'Join Room';
        alert('Could not join room: ' + (err.message || err.type || err));
      }
    );
  });

  function handleGuestData(data) {
    if (data.type === 'start') {
      SB.resetMatch(data.p1Name, data.p2Name);
      startGameUI();
    } else if (data.type === 'state') {
      SB.applyState(data.state);
    } else if (data.type === 'leave') {
      handleOpponentLeft();
    }
  }

  // ---------- practice flow (pass & play) ----------
  els.practiceBtn.addEventListener('click', () => {
    mode = 'practice';
    SB.resetMatch('Player 1', 'Player 2');
    startGameUI();
  });

  // ---------- vs computer ----------
  els.difficulty.addEventListener('click', (e) => {
    const btn = e.target.closest('.diff-btn');
    if (!btn) return;
    cpuLevel = btn.dataset.level;
    els.difficulty.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('active', b === btn));
  });

  els.cpuBtn.addEventListener('click', () => {
    mode = 'cpu';
    botTurn = null;
    const label = cpuLevel[0].toUpperCase() + cpuLevel.slice(1);
    SB.resetMatch('You', `Computer (${label})`);
    startGameUI();
  });

  // How the computer plays each level: how often it tries to knock your
  // puck off, how precisely it hits its power and angle, and which zone
  // it goes for when drawing to score.
  const BOT_LEVELS = {
    easy:   { knock: 0.1,  powerErr: 0.075, angleErr: 0.05,  zones: ['A', 'B', 'C'] },
    medium: { knock: 0.35, powerErr: 0.04,  angleErr: 0.022, zones: ['A', 'A', 'B'] },
    hard:   { knock: 0.65, powerErr: 0.013, angleErr: 0.007, zones: ['A'] }
  };

  // standard normal sample (Box-Muller) - the size of each level's mistakes
  function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

  // Plans a shot straight up a chosen lane (the computer slides its puck
  // sideways first, just like the ◀ ▶ buttons): either draw into a scoring
  // zone through a clear lane, or fire hard at your best puck to knock it off.
  function planBotShot() {
    const s = SB.state, R = SB.PUCK_R, lvl = BOT_LEVELS[cpuLevel];
    const minX = SB.RAIL_L + R + 4, maxX = SB.RAIL_R - R - 4;
    const laneClear = (x, targetY, ignore) => s.pucks.every(p =>
      p === ignore || p.y < targetY - R * 2 || Math.abs(p.x - x) > R * 2 + 3);

    const mine = s.pucks.filter(p => p.owner === 1 && SB.zoneValueAt(p.y) > 0)
      .sort((a, b) => SB.zoneValueAt(b.y) - SB.zoneValueAt(a.y) || a.y - b.y);
    if (mine.length && Math.random() < lvl.knock) {
      const t = mine.find(p => laneClear(p.x, p.y, p));
      if (t) return { x: t.x, power: 1 };
    }

    const zoneKeys = lvl.zones.slice().sort(() => Math.random() - 0.5).concat(['A', 'B', 'C']);
    for (const key of zoneKeys) {
      const z = SB['ZONE_' + key];
      const targetY = (z.top + z.bottom) / 2 + (key === 'A' ? 8 : 0);
      const prefer = SB.W / 2 + (Math.random() - 0.5) * 160;
      const lanes = [];
      for (let x = minX; x <= maxX; x += 8) lanes.push(x);
      lanes.sort((a, b) => Math.abs(a - prefer) - Math.abs(b - prefer));
      const x = lanes.find(lx => laneClear(lx, targetY - R) &&
        s.pucks.every(p => Math.hypot(p.x - lx, p.y - targetY) > R * 2 + 2));
      if (x != null) return { x, power: (SB.START_Y - targetY) / SB.MAX_TRAVEL };
    }
    // everything's blocked: blast the nearest puck in the way
    return { x: s.aimX[2], power: 1 };
  }

  // runs the computer's turn over a few frames so you can watch it:
  // think -> slide to its lane -> show aim + gauge -> shoot
  function runBot(now) {
    const s = SB.state;
    if (mode !== 'cpu' || s.currentShooter !== 2 || s.simulating || s.matchOver) { botTurn = null; SB._botAim = null; return; }
    if (!botTurn) botTurn = { phase: 'think', start: now };
    const t = now - botTurn.start;
    if (botTurn.phase === 'think' && t > 600) {
      botTurn = { phase: 'slide', start: now, plan: planBotShot(), fromX: s.aimX[2] };
    } else if (botTurn.phase === 'slide') {
      const k = Math.min(1, t / 550);
      s.aimX[2] = botTurn.fromX + (botTurn.plan.x - botTurn.fromX) * (1 - Math.pow(1 - k, 3));
      if (k >= 1) {
        const lvl = BOT_LEVELS[cpuLevel];
        const power = Math.max(0.3, Math.min(1, botTurn.plan.power + gauss() * lvl.powerErr));
        const angle = -Math.PI / 2 + gauss() * lvl.angleErr;
        SB._botAim = { angle, power, startTs: now };
        botTurn = { phase: 'aim', start: now, plan: botTurn.plan };
      }
    } else if (botTurn.phase === 'aim' && t > 1000) {
      const { angle, power } = SB._botAim;
      SB._botAim = null;
      botTurn = null;
      SB.shoot({ angle, power });
    }
  }

  // ---------- shared game UI ----------
  function myPlayerId() {
    if (mode === 'practice') return SB.state.currentShooter;
    if (mode === 'host' || mode === 'cpu') return 1;
    if (mode === 'client') return 2;
    return null;
  }

  function canShoot() {
    if (opponentLeft || SB.state.matchOver || SB.state.simulating) return false;
    if (mode === 'practice') return true;
    return SB.state.currentShooter === myPlayerId();
  }

  function startGameUI() {
    els.setupPanel.hidden = true;
    els.gamePanel.hidden = false;

    if (!inputAttached) {
      SB.attachInput({
        canShoot,
        onShoot: (aim) => {
          if (mode === 'client') {
            Net.send({ type: 'shoot', angle: aim.angle, power: aim.power });
          } else {
            const ok = SB.shoot(aim);
            if (ok && mode === 'host') broadcastState();
          }
        }
      });
      inputAttached = true;
    }

    if (!lastTs) requestAnimationFrame(loop);
  }

  els.laneLeftBtn.addEventListener('click', () => nudge(-1));
  els.laneRightBtn.addEventListener('click', () => nudge(1));
  function nudge(dir) {
    if (!canShoot()) return;
    if (mode === 'client') {
      Net.send({ type: 'nudge', dir });
    } else {
      SB.nudgeLane(myPlayerId(), dir);
      if (mode === 'host') broadcastState();
    }
  }

  function handleOpponentLeft() {
    opponentLeft = true;
    SB.addLog('Your opponent left the game.');
  }

  els.leaveBtn.addEventListener('click', () => {
    if (mode === 'host' || mode === 'client') {
      Net.send({ type: 'leave' });
      Net.teardown();
    }
    location.reload();
  });

  window.addEventListener('beforeunload', () => {
    if (mode === 'host' || mode === 'client') Net.send({ type: 'leave' });
  });

  // ---------- HUD ----------
  function updateHUD() {
    const s = SB.state;
    els.p1NameEl.textContent = s.p1Name;
    els.p2NameEl.textContent = s.p2Name;
    els.p1ScoreEl.textContent = s.scores[1];
    els.p2ScoreEl.textContent = s.scores[2];
    els.p1Card.classList.toggle('turn', s.currentShooter === 1 && !s.simulating && !s.matchOver);
    els.p2Card.classList.toggle('turn', s.currentShooter === 2 && !s.simulating && !s.matchOver);
    els.roundLabel.textContent = `Round ${s.round}`;
    const left = SB.PUCKS_PER_PLAYER_PER_ROUND * 2 - s.shotsThisRound;
    els.pucksLeftLabel.textContent = `${left} puck${left === 1 ? '' : 's'} left this round`;

    if (opponentLeft) {
      els.turnStatus.textContent = 'Opponent left the game.';
    } else if (s.matchOver) {
      els.turnStatus.textContent = s.winner
        ? (() => { const n = s.winner === 1 ? s.p1Name : s.p2Name; return n === 'You' ? '🏆 You win the match!' : `🏆 ${n} wins the match!`; })()
        : `It's a tie!`;
    } else if (s.simulating) {
      els.turnStatus.textContent = 'Puck sliding...';
    } else if (SB._charging) {
      els.turnStatus.textContent = '💪 Tap the table to set your power!';
    } else if (mode === 'cpu' && s.currentShooter === 2) {
      els.turnStatus.textContent = '🤖 Computer is lining up a shot...';
    } else {
      const name = s.currentShooter === 1 ? s.p1Name : s.p2Name;
      const isMe = mode === 'practice' || myPlayerId() === s.currentShooter;
      els.turnStatus.textContent = `${name}'s turn${isMe ? ' (you)' : ''}`;
    }

    const logLines = s.log.slice(-8);
    els.log.innerHTML = logLines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    els.log.scrollTop = els.log.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- main loop ----------
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.033) : 0;
    lastTs = ts;

    const isAuthority = mode === 'practice' || mode === 'host' || mode === 'cpu';
    if (mode === 'cpu') runBot(ts);
    if (isAuthority && SB.state.simulating) {
      SB.tick(dt);
      frameCount++;
      if (mode === 'host' && (frameCount % 2 === 0 || !SB.state.simulating)) {
        broadcastState();
      }
    }

    SB.render({ myTurn: canShoot() });
    updateHUD();
  }

  Net.onClose = () => {
    if (mode === 'host' || mode === 'client') handleOpponentLeft();
  };
})();
