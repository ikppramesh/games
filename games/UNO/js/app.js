(function () {
  'use strict';
  const { esc, isWild, needsColor, faceName, colorHex, renderFace, renderBack } = window.UnoCards;
  const THEMES = window.UNO_THEMES;
  const $ = (id) => document.getElementById(id);

  // ---------- local storage (best-effort) ----------
  const store = {
    get(k) { try { return localStorage.getItem('uno.' + k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem('uno.' + k) : localStorage.setItem('uno.' + k, v); } catch (e) { /* ignore */ } },
  };
  function makeToken() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  let token = store.get('token');
  if (!token) { token = makeToken(); store.set('token', token); }

  // ---------- state ----------
  const socket = UnoNet.connect(); // in-browser server + PeerJS (see net.js)
  let meta = { variants: [] };
  let room = null;
  let modal = null; // { key, kind, resolve }
  let lastRevealSeq = 0;
  let lastTopKey = '';
  let lastFxTheme = null;
  let shownPhaseKey = null;

  const inviteCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 5);

  // ---------- small UI helpers ----------
  function show(screen) {
    for (const s of ['home', 'lobby', 'game']) $('screen-' + s).classList.toggle('hidden', s !== screen);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  let bannerTimer;
  function banner(html, ms = 2400) {
    const b = $('banner');
    b.innerHTML = html;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
  }
  function emit(event, data) {
    return new Promise((resolve) => socket.emit(event, data || {}, (res) => resolve(res || { ok: false, error: 'No response' })));
  }
  function getName() {
    const n = $('name').value.trim();
    if (!n) { $('name').focus(); toast('Please enter your name first'); return null; }
    store.set('name', n);
    return n;
  }
  function setUrlRoom(code) {
    const url = code ? `${location.pathname}?room=${code}` : location.pathname;
    history.replaceState(null, '', url);
  }
  const theme = () => THEMES[(room && room.settings.theme) || 'classic'] || THEMES.classic;
  const me = () => room && room.game && room.game.players.find((p) => p.id === room.youId);
  const memberOf = (id) => room && room.members.find((m) => m.id === id);
  const nameOf = (id) => {
    const p = room && room.game && room.game.players.find((x) => x.id === id);
    return p ? p.name : (memberOf(id) || {}).name || '?';
  };

  function avatar(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="avatar" style="--av:${h}">${esc(name.charAt(0).toUpperCase())}</span>`;
  }
  // Stable pseudo-random tilt for a card, so the pile looks hand-dropped.
  const tilt = (id, range) => (((id * 7919) % 1000) / 1000 - 0.5) * range;

  // ---------- theme + effects ----------
  function applyTheme(th, side) {
    const root = document.documentElement.style;
    root.setProperty('--room', th.room);
    root.setProperty('--felt', side ? th.felt.dark : th.felt.light);
    root.setProperty('--rim1', th.rim[0]);
    root.setProperty('--rim2', th.rim[1]);
    root.setProperty('--accent', th.accent);
    document.body.classList.toggle('dark-side', !!side);
    if (lastFxTheme !== th) {
      lastFxTheme = th;
      const fx = $('fx');
      fx.innerHTML = '';
      if (th.fx) {
        for (let i = 0; i < th.fx.count; i++) {
          const s = document.createElement('span');
          s.textContent = th.fx.chars[i % th.fx.chars.length];
          s.style.left = Math.random() * 100 + 'vw';
          s.style.color = th.fx.color;
          s.style.fontSize = 8 + Math.random() * 16 + 'px';
          s.style.animationDuration = 8 + Math.random() * 12 + 's';
          s.style.animationDelay = -Math.random() * 20 + 's';
          fx.appendChild(s);
        }
      }
    }
  }

  // ---------- modal ----------
  function openModal(html, { key = null, kind = 'user', dismissable = false } = {}) {
    closeModal();
    const box = $('modal-box');
    box.innerHTML = html;
    $('modal').classList.remove('hidden');
    return new Promise((resolve) => {
      modal = { key, kind, resolve, dismissable };
    });
  }
  function closeModal(value = null) {
    if (!modal) return;
    const m = modal;
    modal = null;
    $('modal').classList.add('hidden');
    $('modal-box').innerHTML = '';
    m.resolve(value);
  }
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal') && modal && modal.dismissable) closeModal();
    const btn = e.target.closest('[data-value]');
    if (btn && modal) closeModal(btn.dataset.value);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.dismissable) closeModal();
  });

  function colorButtons(palette, th) {
    return `<div class="color-grid">${palette.map((c) => `<button class="color-btn" data-value="${c}" style="--cc:${colorHex(c, th)}"><span>${esc(th.colors[c].label)}</span></button>`).join('')}</div>`;
  }
  function pickColor(title, { key = null, kind = 'user', dismissable = true } = {}) {
    const g = room.game;
    return openModal(`<h2>${esc(title)}</h2>${colorButtons(g.palette, theme())}${dismissable ? '<button class="btn ghost" data-value="">Cancel</button>' : ''}`, { key, kind, dismissable });
  }
  function pickPlayer(title) {
    const g = room.game;
    const others = g.players.filter((p) => !p.out && p.id !== room.youId);
    return openModal(`<h2>${esc(title)}</h2><div class="player-grid">${others.map((p) => `<button class="btn" data-value="${p.id}">${esc(p.name)} <span class="muted">(${p.count} cards)</span></button>`).join('')}</div><button class="btn ghost" data-value="">Cancel</button>`, { dismissable: true });
  }

  // ---------- home ----------
  function fillSelect(sel, items, value) {
    sel.innerHTML = items.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
    if (value != null) sel.value = value;
  }
  function themeItems() { return Object.entries(THEMES).map(([id, t]) => [id, t.name]); }
  function variantItems() { return meta.variants.map((v) => [v.id, v.name]); }

  $('name').value = store.get('name') || '';
  fillSelect($('solo-theme'), themeItems(), store.get('theme') || 'classic');
  fillSelect($('set-theme'), themeItems());
  if (inviteCode) {
    $('join-invite').classList.remove('hidden');
    $('invite-code').textContent = inviteCode;
    $('join-code').value = inviteCode;
  }

  async function joinRoom(code) {
    const name = getName();
    if (!name) return;
    const res = await emit('room:join', { code, name, token });
    if (!res.ok) return toast(res.error);
    store.set('room', res.code);
    setUrlRoom(res.code);
  }

  $('btn-accept-invite').onclick = () => joinRoom(inviteCode);
  $('btn-join').onclick = () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length < 4) return toast('Enter the room code');
    joinRoom(code);
  };
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

  $('btn-create').onclick = async () => {
    const name = getName();
    if (!name) return;
    const res = await emit('room:create', { name, token, settings: { variant: $('solo-variant').value, theme: $('solo-theme').value } });
    if (!res.ok) return toast(res.error);
    store.set('room', res.code);
    setUrlRoom(res.code);
  };

  $('btn-solo').onclick = async () => {
    const name = getName();
    if (!name) return;
    store.set('theme', $('solo-theme').value);
    store.set('variant', $('solo-variant').value);
    const res = await emit('room:create', { name, token, settings: { variant: $('solo-variant').value, theme: $('solo-theme').value } });
    if (!res.ok) return toast(res.error);
    store.set('room', res.code);
    setUrlRoom(res.code);
    const bots = Number($('solo-bots').value) || 1;
    for (let i = 0; i < bots; i++) await emit('room:addBot');
    const s = await emit('room:start');
    if (!s.ok) toast(s.error);
  };

  // ---------- lobby ----------
  function leaveRoom() {
    emit('room:leave');
    store.set('room', null);
    setUrlRoom(null);
    room = null;
    closeModal();
    render();
  }
  $('btn-lobby-leave').onclick = leaveRoom;
  $('btn-game-leave').onclick = async () => {
    const g = room && room.game;
    if (g && g.phase !== 'over') {
      const ok = await openModal('<h2>Leave the game?</h2><p class="muted">A computer player will take your seat.</p><div class="row center"><button class="btn primary" data-value="yes">Leave</button><button class="btn ghost" data-value="">Stay</button></div>', { dismissable: true });
      if (ok !== 'yes') return;
    }
    leaveRoom();
  };

  $('btn-copy').onclick = async () => {
    const input = $('share-link');
    try { await navigator.clipboard.writeText(input.value); toast('Link copied — send it to your friends!'); }
    catch (e) { input.select(); document.execCommand('copy'); toast('Link copied'); }
  };
  if (navigator.share) {
    $('btn-share').classList.remove('hidden');
    $('btn-share').onclick = () => navigator.share({ title: 'Play UNO with me!', text: `Join my UNO game (room ${room.code})`, url: $('share-link').value }).catch(() => {});
  }
  $('btn-add-bot').onclick = async () => { const r = await emit('room:addBot'); if (!r.ok) toast(r.error); };
  $('btn-start').onclick = async () => { const r = await emit('room:start'); if (!r.ok) toast(r.error); };

  const RULE_KEYS = ['handSize', 'stacking', 'drawUntilPlayable', 'sevenZero', 'liar', 'mercyLimit'];
  function collectRules() {
    const r = {};
    for (const k of RULE_KEYS) {
      const el = $('r-' + k);
      r[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
    }
    return r;
  }
  async function sendSettings(s) {
    const r = await emit('room:settings', s);
    if (!r.ok) toast(r.error);
  }
  $('set-variant').onchange = () => sendSettings({ variant: $('set-variant').value });
  $('set-theme').onchange = () => { store.set('theme', $('set-theme').value); sendSettings({ theme: $('set-theme').value }); };
  for (const k of RULE_KEYS) $('r-' + k).onchange = () => sendSettings({ rules: collectRules() });

  $('cc-kind').onchange = () => {
    const needsDraw = ['wildDraw', 'draw', 'wildReverseDraw'].includes($('cc-kind').value);
    $('cc-draw-wrap').classList.toggle('hidden', !needsDraw);
  };
  $('btn-cc-add').onclick = () => {
    const list = [...room.settings.customCards, { kind: $('cc-kind').value, draw: Number($('cc-draw').value), count: Number($('cc-count').value) }];
    sendSettings({ customCards: list });
  };
  $('custom-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const list = room.settings.customCards.filter((_, i) => i !== Number(b.dataset.remove));
    sendSettings({ customCards: list });
  });
  $('member-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kick]');
    if (!b) return;
    const r = await emit('room:remove', { memberId: b.dataset.kick });
    if (!r.ok) toast(r.error);
  });

  const CUSTOM_LABELS = {
    wildDraw: (c) => `Wild Draw +${c.draw} × ${c.count}`,
    draw: (c) => `Draw +${c.draw} × ${c.count} per colour`,
    wildReverseDraw: (c) => `Wild Reverse Draw +${c.draw} × ${c.count}`,
    skipAll: (c) => `Skip Everyone × ${c.count} per colour`,
    discardAll: (c) => `Discard All × ${c.count} per colour`,
    colorRoulette: (c) => `Colour Roulette × ${c.count}`,
  };

  function renderLobby() {
    const isHost = room.hostId === room.youId;
    const th = theme();
    applyTheme(th, 0);
    document.body.classList.toggle('is-host', isHost);
    $('lobby-code').textContent = room.code;
    const link = `${location.origin}${location.pathname}?room=${room.code}`;
    $('share-link').value = link;

    $('player-count').textContent = `(${room.members.length}/${room.maxPlayers})`;
    $('member-list').innerHTML = room.members.map((m) => `
      <li class="${m.connected ? '' : 'offline'}">
        ${avatar(m.name)}
        <span class="mname">${esc(m.name)}${m.id === room.youId ? ' <span class="muted">(you)</span>' : ''}</span>
        ${m.isBot ? '<span class="tag">CPU</span>' : ''}
        ${m.id === room.hostId ? '<span class="tag gold">Host</span>' : ''}
        ${!m.connected ? '<span class="tag">offline</span>' : ''}
        ${isHost && m.id !== room.youId ? `<button class="btn ghost small" data-kick="${m.id}" title="Remove">✕</button>` : ''}
      </li>`).join('');

    const s = room.settings;
    const variant = meta.variants.find((v) => v.id === s.variant) || {};
    if (document.activeElement !== $('set-variant')) fillSelect($('set-variant'), variantItems(), s.variant);
    if (document.activeElement !== $('set-theme')) $('set-theme').value = THEMES[s.theme] ? s.theme : 'classic';
    $('variant-desc').textContent = variant.description || '';
    for (const k of RULE_KEYS) {
      const el = $('r-' + k);
      if (document.activeElement === el) continue;
      if (el.type === 'checkbox') el.checked = !!s.rules[k]; else el.value = s.rules[k];
    }
    $('liar-toggle').classList.toggle('hidden', !!s.rules.flip);
    $('custom-cards-box').classList.toggle('hidden', variant.allowsCustomCards === false);
    $('custom-list').innerHTML = s.customCards.length
      ? s.customCards.map((c, i) => `<li>${esc(CUSTOM_LABELS[c.kind](c))}${isHost ? ` <button class="btn ghost small" data-remove="${i}">✕</button>` : ''}</li>`).join('')
      : '<li class="muted">No custom cards yet. Try adding "Wild Draw +15"!</li>';
    document.querySelectorAll('.host-input').forEach((el) => { el.disabled = !isHost; });

    // Preview a few themed cards.
    const pal = ['red', 'yellow', 'green', 'blue'];
    const sample = [
      { color: pal[0], type: 'number', value: 7 },
      { color: pal[1], type: 'skip' },
      { color: pal[2], type: 'reverse' },
      { color: pal[3], type: 'draw', draw: 2 },
      { color: 'wild', type: 'wild' },
      { color: 'wild', type: 'wildDraw', draw: 4 },
    ];
    $('theme-preview').innerHTML = sample.map((f) => renderFace(f, th, { extraClass: 'small' })).join('') + renderBack(th, 'small');
  }

  // ---------- game ----------
  const TYPE_ORDER = ['number', 'skip', 'reverse', 'draw', 'skipAll', 'discardAll', 'flip', 'wild', 'wildDraw', 'wildReverseDraw', 'wildDrawColor', 'colorRoulette'];
  function sortHand(hand, palette) {
    const ci = (f) => (isWild(f) ? 9 : palette.indexOf(f.color));
    return [...hand].sort((a, b) => ci(a.face) - ci(b.face)
      || TYPE_ORDER.indexOf(a.face.type) - TYPE_ORDER.indexOf(b.face.type)
      || (a.face.value || 0) - (b.face.value || 0)
      || (a.face.draw || 0) - (b.face.draw || 0));
  }

  function logParts(parts, th) {
    return parts.map((p) => {
      if (typeof p === 'string') return esc(p);
      if (p.player) return `<b>${esc(p.player)}</b>`;
      if (p.face) {
        const c = isWild(p.face) ? 'var(--accent)' : colorHex(p.face.color, th);
        return `<span class="chip" style="--cc:${c}">${esc(faceName(p.face, th))}</span>`;
      }
      if (p.color) return `<span class="chip" style="--cc:${colorHex(p.color, th)}">${esc(th.colors[p.color].label)}</span>`;
      return '';
    }).join('');
  }

  function renderGame() {
    const g = room.game;
    const th = theme();
    const mine = me();
    const myId = room.youId;
    applyTheme(th, g.side);

    $('game-title').innerHTML = `<b>${esc(g.variantName)}</b> <span class="muted">· ${esc(th.name)} · Room ${esc(room.code)}</span>`;

    // Opponents, in turn order starting after me.
    const idx = Math.max(0, g.players.findIndex((p) => p.id === myId));
    const order = g.players.slice(idx + 1).concat(g.players.slice(0, idx)).filter((p) => p.id !== myId);
    $('opponents').innerHTML = order.map((p) => {
      const m = memberOf(p.id);
      const offline = m && !m.connected && !m.isBot;
      const shown = Math.min(p.count, 10);
      let minis = '';
      for (let i = 0; i < shown; i++) {
        const rot = shown > 1 ? (i - (shown - 1) / 2) * Math.min(9, 50 / shown) : 0;
        const style = `--rot:${rot.toFixed(1)}deg;`;
        minis += p.backs && p.backs[i] ? renderFace(p.backs[i], th, { side: 1 - g.side, extraClass: 'mini', style }) : renderBack(th, 'mini', style);
      }
      return `<div class="opp ${p.id === g.actorId ? 'turn' : ''} ${p.out ? 'out' : ''} ${offline ? 'offline' : ''}">
        <div class="opp-head">
          ${avatar(p.name)}
          <span class="opp-name">${esc(p.name)}</span>
          ${p.isBot ? '<span class="tag">CPU</span>' : ''}
        </div>
        <div class="opp-cards">${minis}${p.count > shown ? `<span class="more">+${p.count - shown}</span>` : ''}</div>
        <div class="opp-meta">
          <span class="count">${p.out ? 'Out' : p.count + (p.count === 1 ? ' card' : ' cards')}</span>
          ${p.saidUno && p.count === 1 ? '<span class="tag uno-tag">UNO</span>' : ''}
          ${offline ? '<span class="tag">offline</span>' : ''}
        </div>
      </div>`;
    }).join('');

    // Piles
    const depth = Math.min(4, Math.ceil(g.drawCount / 25));
    let stack = '';
    for (let i = depth - 1; i >= 1; i--) stack += renderBack(th, 'under', `--dx:${i * 1.5}px;--dy:${i * 1.5}px;`);
    const drawTop = g.drawTopBack ? renderFace(g.drawTopBack, th, { side: 1 - g.side }) : renderBack(th);
    $('draw-pile').innerHTML = g.drawCount ? stack + drawTop + `<span class="pile-count">${g.drawCount}</span>` : '<div class="pile-empty"></div>';

    const recent = g.recent || [{ id: 0, face: g.top.face, claimed: g.top.claimed }];
    const topKey = recent.map((r) => r.id).join(',') + ':' + g.log.length;
    $('discard-pile').innerHTML = recent.map((r, i) => {
      const last = i === recent.length - 1;
      const style = `--rot:${tilt(r.id, 34).toFixed(1)}deg;--dx:${tilt(r.id + 3, 14).toFixed(1)}px;--dy:${tilt(r.id + 5, 10).toFixed(1)}px;`;
      return renderFace(r.face, th, { side: g.side, style, extraClass: `pile-card ${last && topKey !== lastTopKey ? 'land' : ''}` });
    }).join('') + (g.top.claimed ? '<span class="claim-badge" title="Played face-down — this is what was claimed">?</span>' : '');
    lastTopKey = topKey;

    const colorLabel = th.colors[g.color] ? th.colors[g.color].label : g.color;
    $('color-indicator').innerHTML = `<span class="chip-token" style="--cc:${colorHex(g.color, th)}"></span><span>${esc(colorLabel)}</span>`;
    $('dir-ring').classList.toggle('ccw', g.direction !== 1);
    $('pending-indicator').classList.toggle('hidden', !g.pendingDraw);
    $('pending-indicator').textContent = `+${g.pendingDraw} stacked`;
    $('side-indicator').classList.toggle('hidden', !g.rules.flip);
    $('side-indicator').textContent = g.side ? 'Dark side' : 'Light side';

    // Status line
    const myTurn = g.phase === 'play' && g.turnId === myId;
    const actorName = nameOf(g.actorId);
    let status;
    if (g.phase === 'over') {
      status = `${esc(nameOf(g.winnerId))} wins`;
      if (room.hostId === myId) status += ' <button class="btn primary small" id="btn-again">Play again</button> <button class="btn small" id="btn-to-lobby">Lobby</button>';
    }
    else if (mine && mine.out) status = 'You are out — watch the rest of the game.';
    else if (g.actorId === myId) {
      if (g.phase === 'liarChallenge') status = 'Believe the card, or call LIAR?';
      else if (g.phase === 'roulette') status = 'Colour Roulette — pick a colour!';
      else if (g.phase === 'chooseColor') status = 'Pick the new colour';
      else if (g.pendingDraw) status = `Your turn — stack a draw card or take +${g.pendingDraw}`;
      else if (g.me.drawnCardId != null) status = 'Play the card you drew, or pass';
      else if (g.rules.liar) status = 'Your turn — play any card face-down (bluffing allowed) or draw';
      else status = g.me.playable.length ? 'Your turn — play a highlighted card' : 'Your turn — no match, draw a card';
    } else status = `Waiting for <b>${esc(actorName)}</b>…`;
    $('status').innerHTML = status;
    $('status').classList.toggle('mine', g.actorId === myId && g.phase !== 'over');

    // Buttons
    const canDraw = myTurn && g.me.drawnCardId == null;
    $('btn-draw').disabled = !canDraw;
    $('btn-draw').textContent = g.pendingDraw && myTurn ? `Take +${g.pendingDraw}` : 'Draw';
    $('btn-draw').classList.toggle('pulse', canDraw && !g.rules.liar && g.me.playable.length === 0);
    $('btn-pass').classList.toggle('hidden', !(myTurn && g.me.drawnCardId != null));
    const myCount = mine ? mine.count : 99;
    $('btn-uno').disabled = !mine || mine.out || myCount > 2 || mine.saidUno || g.phase === 'over';
    $('btn-uno').classList.toggle('pulse', !$('btn-uno').disabled && (myCount === 1 || (myCount === 2 && myTurn)));
    $('catch-buttons').innerHTML = g.unoVulnerable && g.unoVulnerable !== myId && mine && !mine.out && g.phase !== 'over'
      ? `<button class="btn danger pulse" data-catch="${g.unoVulnerable}">Catch ${esc(nameOf(g.unoVulnerable))}! (+2)</button>` : '';

    // Hand
    if (g.me) {
      const hand = sortHand(g.me.hand, g.palette);
      const playable = new Set(g.me.playable);
      const clickable = myTurn && (g.rules.liar ? g.me.drawnCardId == null : true);
      $('hand').innerHTML = hand.map((c) => {
        const cls = [
          playable.has(c.id) ? 'playable' : (myTurn && !g.rules.liar ? 'dim' : ''),
          clickable && g.rules.liar ? 'clickable' : '',
          c.id === g.me.drawnCardId ? 'drawn' : '',
        ].join(' ');
        return renderFace(c.face, th, { side: g.side, id: c.id, extraClass: cls });
      }).join('');
      layoutHand();
    } else {
      $('hand').innerHTML = '<p class="muted">You are watching this game.</p>';
    }

    // Log
    const logEl = $('log');
    logEl.innerHTML = g.log.map((e) => `<li>${logParts(e.parts, th)}</li>`).join('');
    logEl.scrollTop = logEl.scrollHeight;

    // Liar reveal
    if (g.lastReveal && g.lastReveal.seq !== lastRevealSeq) {
      lastRevealSeq = g.lastReveal.seq;
      const r = g.lastReveal;
      banner(`<div class="reveal ${r.honest ? 'honest' : 'liar'}">
        <div class="reveal-title">${r.honest ? 'It was the truth' : 'Bluff caught'}</div>
        <div class="reveal-cards">
          <div><div class="small muted">Claimed</div>${renderFace(r.claim, th, { side: g.side })}</div>
          <div><div class="small muted">Actually</div>${renderFace(r.face, th, { side: g.side })}</div>
        </div></div>`, 3200);
    }

    handlePhaseModal(g, th);
  }

  // Overlap the hand so it fits the screen.
  function layoutHand() {
    const el = $('hand');
    const cards = el.querySelectorAll('.card');
    if (!cards.length) return;
    const cw = cards[0].offsetWidth || 80;
    const avail = el.clientWidth - 24;
    const n = cards.length;
    let gap = -cw * 0.28;
    if (n > 1 && n * cw + (n - 1) * gap > avail) gap = Math.max(-cw * 0.66, (avail - cw) / (n - 1) - cw);
    el.style.setProperty('--gap', gap + 'px');
    // Fan the cards like a hand being held: rotate around a point below the hand.
    const spread = Math.min(3.2, 36 / Math.max(n, 1));
    cards.forEach((c, i) => {
      const off = i - (n - 1) / 2;
      c.style.setProperty('--rot', (off * spread).toFixed(2) + 'deg');
      c.style.setProperty('--ty', Math.min(18, Math.abs(off) ** 2 * spread * 0.22).toFixed(1) + 'px');
    });
  }
  window.addEventListener('resize', () => { if (room && room.game) layoutHand(); });

  function handlePhaseModal(g, th) {
    const myId = room.youId;
    let key = null;
    if (g.phase === 'over') key = 'over:' + g.winnerId + ':' + g.log.length;
    else if (g.actorId === myId && g.phase === 'liarChallenge') key = 'liar:' + g.log.length;
    else if (g.actorId === myId && g.phase === 'roulette') key = 'roulette:' + g.log.length;
    else if (g.actorId === myId && g.phase === 'chooseColor') key = 'choose:' + g.log.length;

    // Close stale modals.
    if (modal) {
      if (modal.kind === 'phase' && modal.key !== key) closeModal();
      else if (modal.kind === 'user' && !(g.phase === 'play' && g.turnId === myId)) closeModal();
    }
    if (!key || key === shownPhaseKey) return;
    shownPhaseKey = key;

    if (g.phase === 'over') {
      const isHost = room.hostId === myId;
      const won = g.winnerId === myId;
      openModal(`<div class="gameover">
          <div class="go-kicker">${won ? 'Victory' : 'Game over'}</div>
          <h2>${won ? 'You win' : `${esc(nameOf(g.winnerId))} wins`}</h2>
          <p class="muted">${esc(g.variantName)}</p>
          ${isHost
            ? '<div class="row center"><button class="btn primary" data-value="again">Play again</button><button class="btn" data-value="lobby">Back to lobby</button></div>'
            : '<p class="muted">Waiting for the host to start a new game…</p>'}
          <button class="btn ghost" data-value="close">View table</button>
        </div>`, { key, kind: 'phase' }).then(async (v) => {
        if (v === 'again') { const r = await emit('room:start'); if (!r.ok) toast(r.error); }
        if (v === 'lobby') emit('room:lobby');
      });
      return;
    }
    if (g.phase === 'liarChallenge') {
      const p = g.pending;
      openModal(`<h2>${esc(nameOf(p.liarId))} claims:</h2>
        <div class="center-card">${renderFace(p.claim, th, { side: g.side })}</div>
        <p class="muted">Call LIAR and you win if they bluffed (they take the card back +2). Wrong guess and <b>you</b> draw 2.</p>
        <div class="row center"><button class="btn" data-value="believe">I believe you</button><button class="btn danger" data-value="liar">Liar!</button></div>`,
      { key, kind: 'phase' }).then((v) => { if (v) sendAction({ type: 'challenge', call: v === 'liar' }); });
      return;
    }
    if (g.phase === 'roulette' || g.phase === 'chooseColor') {
      const title = g.phase === 'roulette' ? 'Colour Roulette — pick a colour. You draw until it shows up.' : 'The deck flipped onto a wild — pick a colour';
      pickColor(title, { key, kind: 'phase', dismissable: false }).then((c) => { if (c) sendAction({ type: 'chooseColor', color: c }); });
    }
  }

  async function sendAction(a) {
    const r = await emit('game:action', a);
    if (!r.ok) toast(r.error);
  }

  $('status').addEventListener('click', async (e) => {
    if (e.target.id === 'btn-again') { const r = await emit('room:start'); if (!r.ok) toast(r.error); }
    if (e.target.id === 'btn-to-lobby') emit('room:lobby');
  });
  $('btn-draw').onclick = () => sendAction({ type: 'draw' });
  $('draw-pile').onclick = () => { if (!$('btn-draw').disabled) sendAction({ type: 'draw' }); };
  $('btn-pass').onclick = () => sendAction({ type: 'pass' });
  $('btn-uno').onclick = () => sendAction({ type: 'uno' });
  $('catch-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-catch]');
    if (b) sendAction({ type: 'catch', targetId: b.dataset.catch });
  });
  $('btn-log').onclick = () => $('log-panel').classList.toggle('open');
  $('btn-log-close').onclick = () => $('log-panel').classList.remove('open');

  $('hand').addEventListener('click', (e) => {
    const el = e.target.closest('.card[data-id]');
    if (el) handleCard(Number(el.dataset.id), el);
  });

  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  async function withChoices(g, face, base) {
    const a = { ...base };
    if (needsColor(face)) {
      const c = await pickColor('Choose a colour');
      if (!c) return null;
      a.color = c;
    }
    if (g.rules.sevenZero && face.type === 'number' && face.value === 7) {
      const others = g.players.filter((p) => !p.out && p.id !== room.youId);
      if (others.length > 1) {
        const t = await pickPlayer('7 — swap hands with…');
        if (!t) return null;
        a.targetId = t;
      }
    }
    return a;
  }

  async function handleCard(id, el) {
    const g = room.game;
    if (!(g.phase === 'play' && g.turnId === room.youId)) { shake(el); return toast("It's not your turn"); }
    const card = g.me.hand.find((c) => c.id === id);
    if (!card) return;

    if (g.rules.liar) return liarPlay(g, card);

    if (!g.me.playable.includes(id)) {
      shake(el);
      if (g.me.drawnCardId != null) return toast('You can only play the card you drew — or pass');
      if (g.pendingDraw) return toast(`Stack a draw card, or take +${g.pendingDraw}`);
      return toast('That card does not match the colour or symbol');
    }
    const a = await withChoices(g, card.face, { type: 'play', cardId: id });
    if (a) sendAction(a);
  }

  async function liarPlay(g, card) {
    const th = theme();
    const honest = g.me.playable.includes(card.id);
    const claims = g.me.legalClaims || [];
    const html = `<h2>Play face-down</h2>
      <div class="center-card">${renderFace(card.face, th, { side: g.side })}</div>
      ${honest ? '<button class="btn primary" data-value="honest">Play it honestly</button>' : '<p class="muted">This card does not match — you will have to bluff!</p>'}
      <h3>…or claim it is:</h3>
      <div class="claim-grid">${claims.map((f, i) => `<button class="claim" data-value="c${i}">${renderFace(f, th, { side: g.side, extraClass: 'small' })}</button>`).join('')}</div>
      <button class="btn ghost" data-value="">Cancel</button>`;
    const v = await openModal(html, { dismissable: true });
    if (!v) return;
    let a;
    if (v === 'honest') a = await withChoices(g, card.face, { type: 'play', cardId: card.id });
    else {
      const claim = claims[Number(v.slice(1))];
      a = await withChoices(g, claim, { type: 'play', cardId: card.id, claim });
    }
    if (a) sendAction(a);
  }

  // ---------- main render ----------
  function render() {
    if (!room) {
      show('home');
      applyTheme(THEMES[$('solo-theme').value] || THEMES.classic, 0);
      return;
    }
    if (room.game) {
      show('game');
      renderGame();
    } else {
      closeModal();
      show('lobby');
      renderLobby();
    }
  }
  $('solo-theme').onchange = () => { store.set('theme', $('solo-theme').value); if (!room) render(); };

  // ---------- socket events ----------
  socket.on('meta', (m) => {
    meta = m;
    fillSelect($('solo-variant'), variantItems(), store.get('variant') || 'classic');
    if (room) render();
  });
  socket.on('room:state', (s) => {
    room = s;
    render();
  });
  socket.on('room:kicked', () => {
    room = null;
    store.set('room', null);
    setUrlRoom(null);
    closeModal();
    render();
    toast('You were removed from the room');
  });
  socket.on('connect', async () => {
    const saved = store.get('room');
    const name = store.get('name');
    // An invite link for a different room wins over silently rejoining the last room.
    const code = (room && room.code) || (inviteCode && inviteCode !== saved ? null : saved);
    if (code && name) {
      const res = await emit('room:join', { code, name, token });
      if (!res.ok) {
        store.set('room', null);
        if (room) { room = null; render(); toast(res.error); }
      } else setUrlRoom(res.code);
    }
  });
  socket.on('disconnect', () => toast('Connection lost — reconnecting…'));

  render();
})();
