/* Table Shuffleboard - core physics, rules and rendering.
   Works standalone (practice mode) or driven by an authoritative host
   over the network (see net.js / main.js). Only the "authority"
   (the host, or the local player in practice mode) calls tick()/shoot();
   everyone else just calls applyState() + render().

   Gameplay/physics run entirely in a flat logical coordinate space
   (x: 0..W, y: 0..H, no perspective). Only rendering (and the input
   handler, which has to invert it) applies a one-point perspective so
   the table reads as a lane receding into the distance, like a real
   shuffleboard table viewed from the shooter's end. */
(function (global) {
  const W = 640, H = 960;
  const RAIL_L = 60, RAIL_R = 580;
  const PUCK_R = 22;
  const FRICTION_DECEL = 230;      // px/s^2
  const MAX_PULL = 150;            // px
  const DIST_PER_PULL = 6;         // pull px -> intended travel distance px (linear, so zones feel evenly spaced)
  const MAX_STEER_RAD = 0.6;       // how far left/right a full sideways drag can steer the shot (~34 deg)
  const START_Y = 890;
  const FOUL_LINE_Y = 760;         // must cross above this to count
  const OFF_TOP_Y = 40;            // above this = fell off the far end
  const OFF_BOTTOM_Y = 930;        // knocked back off the near end
  const ZONE_A = { top: 40, bottom: 140, value: 10, color: '#c0394a' };
  const ZONE_B = { top: 140, bottom: 235, value: 8, color: '#c67a2e' };
  const ZONE_C = { top: 235, bottom: 335, value: 7, color: '#c2a13a' };
  const PUCKS_PER_PLAYER_PER_ROUND = 4;
  const WIN_SCORE = 21;
  const SETTLE_EPS = 6; // px/s
  const FLASH_MS = 900;
  const CHARGE_PERIOD_MS = 1100;   // one full 0->100->0 sweep of the power meter
  const AIM_PREVIEW_LEN = 460;     // fixed logical length of the direction line (power is separate now)

  // red and blue weights, like a real shuffleboard set
  const PLAYER_COLOR = { 1: '#d63a3a', 2: '#2f6fd6' };
  const PLAYER_COLOR_DARK = { 1: '#7e1414', 2: '#123a86' };
  const CONFETTI_COLORS = ['#d63a3a', '#2f6fd6', '#f4d35e', '#ffffff', '#e0b04a'];
  let DPR = 1; // device pixels per logical pixel, set in init()

  // Table is drawn flat/normal (no perspective taper) - FAR_SCALE=1 makes
  // scaleAtY()/toScreenX() a no-op identity transform, so all the geometry
  // below (rails, zones, pucks) just renders as a plain rectangle.
  const CX = W / 2;
  const FAR_SCALE = 1;
  const RAIL_TOP = 16; // small margin between the picture frame and the rails
  function scaleAtY(y) { return FAR_SCALE + (1 - FAR_SCALE) * (y / H); }
  function toScreenX(x, y) { return CX + (x - CX) * scaleAtY(y); }
  function toLogicalX(sx, y) { return CX + (sx - CX) / scaleAtY(y); }

  function zoneValueAt(y) {
    if (y >= ZONE_A.top && y < ZONE_A.bottom) return ZONE_A.value;
    if (y >= ZONE_B.top && y < ZONE_B.bottom) return ZONE_B.value;
    if (y >= ZONE_C.top && y < ZONE_C.bottom) return ZONE_C.value;
    return 0;
  }

  // Given a raw drag vector, work out the shot's aim distance/angle.
  // Shared by shoot() and the aim-line preview so what you see is what you get.
  // Shots always travel up the table; the horizontal component just steers
  // left/right, so it doesn't matter whether you drag toward the target or
  // pull back away from it - either reads naturally.
  function computeAim(dx, dy) {
    const dist = Math.min(Math.hypot(dx, dy), MAX_PULL);
    const steer = dist > 0 ? Math.max(-1, Math.min(1, dx / MAX_PULL)) : 0;
    const angle = -Math.PI / 2 + steer * MAX_STEER_RAD;
    return { dist, angle, power: dist / MAX_PULL };
  }

  // The power meter bounces 0 -> 1 -> 0 on a fixed period; both the render
  // loop (to draw it) and the lock-in tap (to read the value) call this
  // with the same startTs so what's on screen is exactly what fires.
  function chargeValue(startTs) {
    const elapsed = performance.now() - startTs;
    const t = (elapsed % CHARGE_PERIOD_MS) / CHARGE_PERIOD_MS;
    return t < 0.5 ? t * 2 : 2 - t * 2;
  }

  function freshState() {
    return {
      p1Name: 'Player 1',
      p2Name: 'Player 2',
      scores: { 1: 0, 2: 0 },
      round: 1,
      roundStarter: 1,
      currentShooter: 1,
      shotsThisRound: 0,
      pucks: [],           // {x,y,vx,vy,owner,id,flashUntil}
      simulating: false,
      matchOver: false,
      winner: null,
      aimX: { 1: W / 2, 2: W / 2 },
      log: []
    };
  }

  // weights turn slowly as they slide; derived from position so host and
  // guests see the same rotation without sending extra state
  function puckSpin(p) { return -Math.PI / 2 + ((p.id * 1.7) + (p.y + p.x * 0.6) / 55) % (Math.PI * 2); }

  const SB = {
    W, H, RAIL_L, RAIL_R, PUCK_R, START_Y, FOUL_LINE_Y, OFF_TOP_Y,
    ZONE_A, ZONE_B, ZONE_C, PUCKS_PER_PLAYER_PER_ROUND, WIN_SCORE,
    PLAYER_COLOR,
    MAX_TRAVEL: MAX_PULL * DIST_PER_PULL, // how far a 100%-power shot slides on an empty table
    zoneValueAt,
    state: freshState(),
    authority: false,
    canvas: null,
    ctx: null,
    _puckId: 1,
    _dragging: null,      // {startX,startY,curX,curY} - drag-to-aim phase
    _charging: null,      // {angle,startTs} - power meter phase, after aim is locked
    _botAim: null,        // {angle,power,startTs} - the computer's aim/power, shown before it shoots
    _trails: {},           // puckId -> [{x,y}]
    _confetti: [],
    _confettiTs: 0,
    _prevMatchOver: false,
    _tableTexture: null,

    init(canvas) {
      this.canvas = canvas;
      DPR = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      this.ctx = canvas.getContext('2d');
      this._tableTexture = buildTableTexture();
    },

    resetMatch(p1Name, p2Name) {
      this.state = freshState();
      this.state.p1Name = p1Name || 'Player 1';
      this.state.p2Name = p2Name || 'Player 2';
      this._trails = {};
      this._confetti = [];
      this._prevMatchOver = false;
      this._dragging = null;
      this._charging = null;
      this._botAim = null;
    },

    addLog(msg) {
      this.state.log.push(msg);
      if (this.state.log.length > 50) this.state.log.shift();
    },

    // ---- Shooting (authority only) ----
    // aim: {angle, power} - angle in radians (from the drag), power 0..1
    // (from where the meter was tapped/locked in).
    shoot(aim) {
      const s = this.state;
      if (s.simulating || s.matchOver) return false;
      const power = Math.max(0, Math.min(1, aim.power));
      if (power < 0.04) return false; // essentially zero, ignore
      // pick speed so the puck's natural friction-limited stopping distance
      // scales linearly with power (constant deceleration: d = v^2 / 2a)
      const intendedDistance = power * MAX_PULL * DIST_PER_PULL;
      const speed = Math.sqrt(2 * FRICTION_DECEL * intendedDistance);
      const owner = s.currentShooter;
      s.pucks.push({
        id: this._puckId++,
        x: s.aimX[owner],
        y: START_Y,
        vx: Math.cos(aim.angle) * speed,
        vy: Math.sin(aim.angle) * speed,
        owner,
        flashUntil: 0
      });
      s.simulating = true;
      s.shotsThisRound += 1;
      this._trails = {};
      return true;
    },

    nudgeLane(playerId, dir) {
      const s = this.state;
      if (s.simulating) return;
      const min = RAIL_L + PUCK_R + 4, max = RAIL_R - PUCK_R - 4;
      s.aimX[playerId] = Math.max(min, Math.min(max, s.aimX[playerId] + dir * 24));
    },

    // ---- Physics (authority only) ----
    tick(dt) {
      const s = this.state;
      if (!s.simulating) return true;
      const pucks = s.pucks;

      for (const p of pucks) {
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 0) {
          const newSpeed = Math.max(0, speed - FRICTION_DECEL * dt);
          const scale = newSpeed / speed;
          p.vx *= scale;
          p.vy *= scale;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // side rails bounce
        if (p.x - PUCK_R < RAIL_L) { p.x = RAIL_L + PUCK_R; p.vx = Math.abs(p.vx) * 0.55; }
        if (p.x + PUCK_R > RAIL_R) { p.x = RAIL_R - PUCK_R; p.vx = -Math.abs(p.vx) * 0.55; }
      }

      // puck-puck collisions (equal mass elastic, simple circle resolve)
      for (let i = 0; i < pucks.length; i++) {
        for (let j = i + 1; j < pucks.length; j++) {
          const a = pucks[i], b = pucks[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const overlap = PUCK_R * 2 - dist;
          if (overlap > 0) {
            const nx = dx / dist, ny = dy / dist;
            const push = overlap / 2;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;

            const avn = a.vx * nx + a.vy * ny;
            const bvn = b.vx * nx + b.vy * ny;
            const diff = bvn - avn;
            a.vx += diff * nx; a.vy += diff * ny;
            b.vx -= diff * nx; b.vy -= diff * ny;
          }
        }
      }

      // settle check
      const allSlow = pucks.every(p => Math.hypot(p.vx, p.vy) < SETTLE_EPS);
      if (allSlow) {
        for (const p of pucks) { p.vx = 0; p.vy = 0; }
        this._onSettle();
        return true;
      }
      return false;
    },

    _onSettle() {
      const s = this.state;
      s.simulating = false;

      // remove fouled pucks: fell off the far end, or never crossed the foul line,
      // or got knocked back off the near end
      s.pucks = s.pucks.filter(p => {
        if (p.y < OFF_TOP_Y) return false;
        if (p.y > OFF_BOTTOM_Y) return false;
        if (p.y > FOUL_LINE_Y) return false; // didn't make it far enough onto the table
        return true;
      });

      // flag the puck that just landed if it's sitting in a scoring zone,
      // so it gets a brief celebratory glow
      const justShot = s.pucks[s.pucks.length - 1];
      if (justShot && zoneValueAt(justShot.y) > 0) {
        justShot.flashUntil = Date.now() + FLASH_MS;
      }

      if (s.shotsThisRound < PUCKS_PER_PLAYER_PER_ROUND * 2) {
        s.currentShooter = s.currentShooter === 1 ? 2 : 1;
      } else {
        this._scoreRound();
      }
    },

    _scoreRound() {
      const s = this.state;
      let p1Add = 0, p2Add = 0;
      for (const p of s.pucks) {
        const v = zoneValueAt(p.y);
        if (v > 0) { if (p.owner === 1) p1Add += v; else p2Add += v; }
      }
      s.scores[1] += p1Add;
      s.scores[2] += p2Add;
      this.addLog(`Round ${s.round}: ${s.p1Name} +${p1Add}, ${s.p2Name} +${p2Add}`);

      if (s.scores[1] >= WIN_SCORE || s.scores[2] >= WIN_SCORE) {
        s.matchOver = true;
        s.winner = s.scores[1] === s.scores[2]
          ? null
          : (s.scores[1] > s.scores[2] ? 1 : 2);
        const winnerName = s.winner === 1 ? s.p1Name : s.p2Name;
        this.addLog(s.winner ? (winnerName === 'You' ? 'You win!' : `${winnerName} wins!`) : `It's a tie!`);
        return;
      }

      s.round += 1;
      s.roundStarter = s.roundStarter === 1 ? 2 : 1;
      s.currentShooter = s.roundStarter;
      s.shotsThisRound = 0;
      s.pucks = [];
    },

    // ---- Networking helpers ----
    serializeState() {
      const s = this.state;
      return {
        p1Name: s.p1Name, p2Name: s.p2Name,
        scores: { 1: s.scores[1], 2: s.scores[2] },
        round: s.round, roundStarter: s.roundStarter,
        currentShooter: s.currentShooter, shotsThisRound: s.shotsThisRound,
        pucks: s.pucks.map(p => ({ id: p.id, x: p.x, y: p.y, owner: p.owner, flashUntil: p.flashUntil || 0 })),
        simulating: s.simulating, matchOver: s.matchOver, winner: s.winner,
        aimX: { 1: s.aimX[1], 2: s.aimX[2] },
        log: s.log.slice(-5)
      };
    },

    applyState(remote) {
      const s = this.state;
      Object.assign(s, remote);
    },

    // ---- Input (drag to shoot, any direction) ----
    attachInput({ canShoot, onShoot }) {
      const canvas = this.canvas;
      const self = this;

      function toLocal(evt) {
        const rect = canvas.getBoundingClientRect();
        const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        const sx = (clientX - rect.left) * (W / rect.width);
        const sy = (clientY - rect.top) * (H / rect.height);
        return { x: toLogicalX(sx, sy), y: sy };
      }

      function down(evt) {
        // second tap: the power meter is running, lock it in and fire
        if (self._charging) {
          evt.preventDefault();
          const angle = self._charging.angle;
          const power = chargeValue(self._charging.startTs);
          self._charging = null;
          onShoot({ angle, power });
          return;
        }
        // first tap: start dragging to aim
        if (!canShoot()) return;
        evt.preventDefault();
        const pt = toLocal(evt);
        self._dragging = { startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
      }
      function move(evt) {
        if (!self._dragging) return;
        evt.preventDefault();
        const pt = toLocal(evt);
        self._dragging.curX = pt.x;
        self._dragging.curY = pt.y;
      }
      function up(evt) {
        if (!self._dragging) return;
        const d = self._dragging;
        self._dragging = null;
        const dx = d.curX - d.startX;
        const dy = d.curY - d.startY;
        // any drag with enough length locks in a direction and starts the
        // power meter - direction (toward the target or pulled back)
        // doesn't matter, see computeAim(). Tap again to set the power.
        if (Math.hypot(dx, dy) > 8) {
          const aim = computeAim(dx, dy);
          self._charging = { angle: aim.angle, startTs: performance.now() };
        }
      }

      canvas.addEventListener('mousedown', down);
      canvas.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      canvas.addEventListener('touchstart', down, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', up);
    },

    _spawnConfetti(winnerColor) {
      const particles = [];
      for (let i = 0; i < 90; i++) {
        particles.push({
          x: W / 2 + (Math.random() - 0.5) * 200,
          y: H * 0.35 + (Math.random() - 0.5) * 100,
          vx: (Math.random() - 0.5) * 260,
          vy: -Math.random() * 260 - 80,
          color: Math.random() < 0.35 ? winnerColor : CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
          size: 4 + Math.random() * 5,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 10,
          life: 1
        });
      }
      this._confetti = particles;
      this._confettiTs = performance.now();
    },

    _updateConfetti() {
      const now = performance.now();
      const dt = Math.min((now - (this._confettiTs || now)) / 1000, 0.05);
      this._confettiTs = now;
      const g = 420;
      this._confetti = this._confetti.filter(p => p.life > 0);
      for (const p of this._confetti) {
        p.vy += g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.rotSpeed * dt;
        p.life -= dt * 0.35;
      }
    },

    // ---- Rendering ----
    render(opts) {
      opts = opts || {};
      const ctx = this.ctx;
      const s = this.state;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // baked table: cabinet, gutters, bumpers, maple playfield, zones, foul line
      ctx.drawImage(this._tableTexture, 0, 0, W, H);

      // --- trails ---
      if (s.simulating) {
        for (const p of s.pucks) {
          const trail = this._trails[p.id];
          if (!trail) continue;
          for (let i = 0; i < trail.length; i++) {
            const t = trail[i];
            const age = (i + 1) / trail.length;
            const scale = scaleAtY(t.y);
            ctx.beginPath();
            ctx.globalAlpha = age * 0.16;
            ctx.arc(toScreenX(t.x, t.y), t.y, PUCK_R * 0.85 * age * scale, 0, Math.PI * 2);
            ctx.fillStyle = '#fffaf0';
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }

      // --- pucks (perspective-scaled metal-weight look + landing glow) ---
      const now = Date.now();
      for (const p of s.pucks) {
        const scale = scaleAtY(p.y);
        const sx = toScreenX(p.x, p.y);
        const r = PUCK_R * scale;

        if (p.flashUntil && now < p.flashUntil) {
          const t = 1 - (p.flashUntil - now) / FLASH_MS; // 0..1
          const ringR = r + (6 + t * 22) * scale;
          ctx.beginPath();
          ctx.arc(sx, p.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = PLAYER_COLOR[p.owner];
          ctx.globalAlpha = 0.6 * (1 - t);
          ctx.lineWidth = 4 * scale;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        drawPuck(ctx, sx, p.y, r, PLAYER_COLOR[p.owner], PLAYER_COLOR_DARK[p.owner], puckSpin(p));
      }

      // ghost / next puck (idle breathing animation)
      if (!s.matchOver && !s.simulating) {
        const owner = s.currentShooter;
        const scale = scaleAtY(START_Y);
        const pulse = Math.sin(performance.now() / 380) * 0.06 + 1;
        ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 380) * 0.12;
        drawPuck(ctx, toScreenX(s.aimX[owner], START_Y), START_Y, PUCK_R * scale * pulse, PLAYER_COLOR[owner], PLAYER_COLOR_DARK[owner], -Math.PI / 2);
        ctx.globalAlpha = 1;
      }

      // direction line while dragging - fixed length, since power is set
      // afterward by the meter, not by how far you drag
      if (this._dragging) {
        const owner = s.currentShooter;
        const d = this._dragging;
        const aim = computeAim(d.curX - d.startX, d.curY - d.startY);
        drawDirectionLine(ctx, s.aimX[owner], START_Y, aim.angle, AIM_PREVIEW_LEN, PLAYER_COLOR[owner]);
      }

      // power meter while charging - direction is locked, bar bounces
      // 0-100-0 until the player taps again to fire at that power
      if (this._charging) {
        const owner = s.currentShooter;
        const value = chargeValue(this._charging.startTs);
        drawDirectionLine(ctx, s.aimX[owner], START_Y, this._charging.angle, AIM_PREVIEW_LEN, PLAYER_COLOR[owner], { alpha: 0.5 });
        const sx = toScreenX(s.aimX[owner], START_Y);
        const side = s.aimX[owner] > CX ? -1 : 1;
        drawPowerMeter(ctx, sx + side * 52, START_Y, value, PLAYER_COLOR[owner]);
      }

      // your turn: the shooter's end of the table glows in your colour
      // the computer lining up its shot: aim line + gauge filling to its power
      if (this._botAim) {
        const owner = s.currentShooter;
        const b = this._botAim;
        const fill = Math.min(1, (performance.now() - b.startTs) / 650);
        drawDirectionLine(ctx, s.aimX[owner], START_Y, b.angle, AIM_PREVIEW_LEN, PLAYER_COLOR[owner], { alpha: 0.55 });
        const sx = toScreenX(s.aimX[owner], START_Y);
        const side = s.aimX[owner] > CX ? -1 : 1;
        drawPowerMeter(ctx, sx + side * 52, START_Y, b.power * fill, PLAYER_COLOR[owner], 'CPU');
      }

      if (opts.myTurn && !s.simulating && !s.matchOver) {
        const glow = ctx.createLinearGradient(0, H, 0, H - 150);
        glow.addColorStop(0, PLAYER_COLOR[s.currentShooter]);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.globalAlpha = 0.28 + Math.sin(performance.now() / 420) * 0.08;
        ctx.fillStyle = glow;
        ctx.fillRect(RAIL_L, H - 150, RAIL_R - RAIL_L, 150);
        ctx.restore();
      }

      // --- confetti on match win ---
      if (s.matchOver && !this._prevMatchOver) {
        this._spawnConfetti(s.winner ? PLAYER_COLOR[s.winner] : '#ffffff');
      }
      this._prevMatchOver = s.matchOver;
      if (this._confetti.length) {
        this._updateConfetti();
        for (const p of this._confetti) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      }

      // update trails after drawing (so the very first frame of a shot has no trail yet)
      if (s.simulating) {
        for (const p of s.pucks) {
          const speed = Math.hypot(p.vx, p.vy);
          if (speed < 4) continue;
          if (!this._trails[p.id]) this._trails[p.id] = [];
          const trail = this._trails[p.id];
          trail.push({ x: p.x, y: p.y });
          if (trail.length > 8) trail.shift();
        }
      } else if (Object.keys(this._trails).length) {
        this._trails = {};
      }
    }
  };

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  // seeded PRNG so the table's grain looks the same on every load/device
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // A real shuffleboard weight seen from above: soft contact shadow on the
  // lacquer, a brushed-chrome body with a bevelled edge, and a coloured cap
  // with a groove and a spin mark (spin = rotation angle in radians).
  function drawPuck(ctx, sx, sy, r, color, colorDark, spin) {
    // shadow + faint reflection on the glossy table
    ctx.save();
    ctx.shadowColor = 'rgba(20,10,0,0.55)';
    ctx.shadowBlur = r * 0.55 * DPR;
    ctx.shadowOffsetX = r * 0.12 * DPR;
    ctx.shadowOffsetY = r * 0.28 * DPR;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#7d858f';
    ctx.fill();
    ctx.restore();

    // brushed chrome body
    let metal;
    if (ctx.createConicGradient) {
      metal = ctx.createConicGradient(-0.6, sx, sy);
      const stops = ['#f7f9fc', '#8e97a2', '#e3e8ee', '#6b7480', '#f2f5f9', '#9aa3ae', '#dfe4ea', '#707984', '#f7f9fc'];
      stops.forEach((c, i) => metal.addColorStop(i / (stops.length - 1), c));
    } else {
      metal = ctx.createLinearGradient(sx - r, sy - r, sx + r, sy + r);
      metal.addColorStop(0, '#f7f9fc');
      metal.addColorStop(0.5, '#8e97a2');
      metal.addColorStop(1, '#e3e8ee');
    }
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = 'rgba(30,34,40,0.7)';
    ctx.stroke();
    // bevel between body and cap
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = r * 0.05;
    ctx.stroke();

    // coloured cap
    const cap = ctx.createRadialGradient(sx - r * 0.25, sy - r * 0.3, r * 0.05, sx, sy, r * 0.76);
    cap.addColorStop(0, shade(color, 70));
    cap.addColorStop(0.45, color);
    cap.addColorStop(1, colorDark);
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.74, 0, Math.PI * 2);
    ctx.fillStyle = cap;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = r * 0.04;
    ctx.stroke();
    // groove ring + centre boss
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.46, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = r * 0.06;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy + r * 0.02, r * 0.46, Math.PI * 0.05, Math.PI * 0.95);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = r * 0.03;
    ctx.stroke();
    // spin mark so you can see the weight rotate as it slides
    const a = spin || 0;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * r * 0.52, sy + Math.sin(a) * r * 0.52);
    ctx.lineTo(sx + Math.cos(a) * r * 0.68, sy + Math.sin(a) * r * 0.68);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = r * 0.09;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
    // glossy highlight
    ctx.beginPath();
    ctx.ellipse(sx - r * 0.2, sy - r * 0.32, r * 0.38, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  }

  // Aim guide: a chalk-dotted line with an arrowhead.
  function drawDirectionLine(ctx, lx0, ly0, angle, len, color, opts) {
    opts = opts || {};
    const alpha = opts.alpha != null ? opts.alpha : 0.9;
    const lx1 = lx0 + Math.cos(angle) * len;
    const ly1 = ly0 + Math.sin(angle) * len;
    ctx.save();
    ctx.globalAlpha = alpha;
    const dots = 26;
    for (let i = 2; i <= dots; i++) {
      const t = i / dots;
      const px = toScreenX(lx0 + (lx1 - lx0) * t, ly0 + (ly1 - ly0) * t);
      const py = ly0 + (ly1 - ly0) * t;
      ctx.beginPath();
      ctx.arc(px, py, 3.2 - t * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? '#ffffff' : color;
      ctx.fill();
    }
    // arrowhead
    const ex = toScreenX(lx1, ly1);
    ctx.translate(ex, ly1);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, -8);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 8);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 4 * DPR;
    ctx.fill();
    ctx.restore();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // The bouncing strength gauge: a brushed-metal housing with a
  // green-amber-red scale, a glowing fill and a needle, plus the % and TAP cue.
  function drawPowerMeter(ctx, sx, sy, value, color, label) {
    const w = 26, h = 150;
    const x0 = sx - w / 2, yBottom = sy + 6, yTop = yBottom - h;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8 * DPR;
    ctx.shadowOffsetY = 3 * DPR;
    roundRectPath(ctx, x0 - 5, yTop - 5, w + 10, h + 10, 12);
    const housing = ctx.createLinearGradient(x0 - 5, 0, x0 + w + 5, 0);
    housing.addColorStop(0, '#5b626b');
    housing.addColorStop(0.5, '#d9dee4');
    housing.addColorStop(1, '#4d535b');
    ctx.fillStyle = housing;
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x0, yTop, w, h, 8);
    ctx.clip();
    ctx.fillStyle = '#16181c';
    ctx.fillRect(x0, yTop, w, h);
    const scale = ctx.createLinearGradient(0, yBottom, 0, yTop);
    scale.addColorStop(0, '#2ecc71');
    scale.addColorStop(0.55, '#f1c40f');
    scale.addColorStop(1, '#e74c3c');
    const fillH = h * value;
    ctx.fillStyle = scale;
    ctx.fillRect(x0, yBottom - fillH, w, fillH);
    // glassy sheen + tick marks
    const sheen = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
    sheen.addColorStop(0.4, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x0, yTop, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const ty = yBottom - (h * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x0, ty);
      ctx.lineTo(x0 + (i % 5 ? 6 : 11), ty);
      ctx.stroke();
    }
    ctx.restore();

    // needle
    const ny = yBottom - fillH;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x0 - 9, ny - 5);
    ctx.lineTo(x0 - 1, ny);
    ctx.lineTo(x0 - 9, ny + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x0, ny - 1.25, w, 2.5);

    ctx.textAlign = 'center';
    ctx.font = 'bold 17px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 4 * DPR;
    ctx.fillText(`${Math.round(value * 100)}%`, sx, yTop - 14);
    ctx.font = 'bold 12px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(label || 'TAP!', sx, yBottom + 22);
    ctx.shadowBlur = 0;
  }

  // Bakes the whole table into an offscreen canvas once (at device
  // resolution) so render() just blits it: walnut cabinet, padded gutters,
  // black rubber bumpers, a lacquered maple playfield with fine grain and
  // wax beads, painted scoring zones, the far-end drop-off and the lamps'
  // reflections in the finish.
  function buildTableTexture() {
    const tex = document.createElement('canvas');
    tex.width = Math.round(W * DPR);
    tex.height = Math.round(H * DPR);
    const c = tex.getContext('2d');
    c.scale(DPR, DPR);
    const r = rng(7);
    const FRAME = 22, BUMPER = 7;
    const L = RAIL_L, R = RAIL_R;

    // --- walnut cabinet ---
    const walnut = c.createLinearGradient(0, 0, W, 0);
    walnut.addColorStop(0, '#2a160a');
    walnut.addColorStop(0.03, '#5a3317');
    walnut.addColorStop(0.07, '#3a1f0e');
    walnut.addColorStop(0.93, '#3a1f0e');
    walnut.addColorStop(0.97, '#5a3317');
    walnut.addColorStop(1, '#2a160a');
    c.fillStyle = walnut;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const x = r() < 0.5 ? r() * FRAME : W - r() * FRAME;
      c.strokeStyle = `rgba(20,8,2,${(0.2 + r() * 0.3).toFixed(2)})`;
      c.lineWidth = 0.5 + r();
      c.beginPath();
      c.moveTo(x, 0);
      c.bezierCurveTo(x + (r() - 0.5) * 6, H * 0.3, x + (r() - 0.5) * 6, H * 0.7, x + (r() - 0.5) * 4, H);
      c.stroke();
    }

    // --- padded gutters (troughs) along both sides and across the far end ---
    const gutter = (x, y, w, h, horizontal) => {
      const g = horizontal ? c.createLinearGradient(0, y, 0, y + h) : c.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#07080a');
      g.addColorStop(0.5, '#1c1f24');
      g.addColorStop(1, '#07080a');
      c.fillStyle = g;
      c.fillRect(x, y, w, h);
    };
    gutter(FRAME, FRAME, L - BUMPER - FRAME, H - FRAME, false);
    gutter(R + BUMPER, FRAME, W - FRAME - R - BUMPER, H - FRAME, false);
    gutter(FRAME, FRAME, W - FRAME * 2, OFF_TOP_Y - FRAME + 2, true);
    // felt texture in the gutters
    for (let i = 0; i < 900; i++) {
      const left = r() < 0.5;
      const x = left ? FRAME + r() * (L - BUMPER - FRAME) : R + BUMPER + r() * (W - FRAME - R - BUMPER);
      c.fillStyle = `rgba(255,255,255,${(0.02 + r() * 0.04).toFixed(3)})`;
      c.fillRect(x, FRAME + r() * (H - FRAME), 1, 1);
    }

    // --- maple playfield ---
    c.save();
    c.beginPath();
    c.rect(L, OFF_TOP_Y, R - L, H - OFF_TOP_Y);
    c.clip();
    const maple = c.createLinearGradient(L, 0, R, 0);
    maple.addColorStop(0, '#d9ae6e');
    maple.addColorStop(0.5, '#ecc98f');
    maple.addColorStop(1, '#d6a966');
    c.fillStyle = maple;
    c.fillRect(L, 0, R - L, H);
    // fine vertical grain: many long, slightly wavy strands
    for (let i = 0; i < 260; i++) {
      const x = L + r() * (R - L);
      const y0 = OFF_TOP_Y + r() * H * 0.6 - 100;
      const len = 200 + r() * 700;
      const wav = (r() - 0.5) * 8;
      const dark = r() < 0.72;
      c.strokeStyle = dark ? `rgba(120,70,25,${(0.05 + r() * 0.12).toFixed(3)})` : `rgba(255,240,205,${(0.05 + r() * 0.1).toFixed(3)})`;
      c.lineWidth = 0.4 + r() * 1.3;
      c.beginPath();
      c.moveTo(x, y0);
      c.bezierCurveTo(x + wav, y0 + len * 0.33, x - wav, y0 + len * 0.66, x + wav * 0.5, y0 + len);
      c.stroke();
    }
    // a couple of soft figure flecks
    for (let i = 0; i < 5; i++) {
      const x = L + 30 + r() * (R - L - 60), y = OFF_TOP_Y + 80 + r() * (H - 200);
      const g = c.createRadialGradient(x, y, 0, x, y, 18 + r() * 14);
      g.addColorStop(0, 'rgba(140,85,35,0.18)');
      g.addColorStop(1, 'rgba(140,85,35,0)');
      c.fillStyle = g;
      c.fillRect(x - 40, y - 40, 80, 80);
    }

    // --- painted scoring zones: tinted bands, black lines, big numbers ---
    [ZONE_A, ZONE_B, ZONE_C].forEach(z => {
      c.fillStyle = z.color;
      c.globalAlpha = 0.28;
      c.fillRect(L, z.top, R - L, z.bottom - z.top);
      c.globalAlpha = 1;
      const midY = (z.top + z.bottom) / 2;
      c.font = 'bold 44px Georgia, "Times New Roman", serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(25,14,6,0.72)';
      c.fillText(z.value, CX, midY + 2);
      c.font = 'bold 13px Georgia, serif';
      c.fillStyle = 'rgba(25,14,6,0.45)';
      c.fillText(z.value, L + 24, midY);
      c.fillText(z.value, R - 24, midY);
    });
    c.strokeStyle = 'rgba(25,14,6,0.85)';
    c.lineWidth = 3;
    for (const y of [ZONE_A.bottom, ZONE_B.bottom, ZONE_C.bottom]) {
      c.beginPath();
      c.moveTo(L, y);
      c.lineTo(R, y);
      c.stroke();
    }

    // foul line + shooter's box
    c.strokeStyle = 'rgba(25,14,6,0.8)';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(L, FOUL_LINE_Y);
    c.lineTo(R, FOUL_LINE_Y);
    c.stroke();
    c.font = 'bold 10px -apple-system, "Segoe UI", Roboto, sans-serif';
    c.fillStyle = 'rgba(25,14,6,0.55)';
    c.textAlign = 'center';
    c.fillText('FOUL LINE', CX, FOUL_LINE_Y + 12);
    c.setLineDash([5, 6]);
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(25,14,6,0.35)';
    c.beginPath();
    c.moveTo(L, START_Y - PUCK_R - 12);
    c.lineTo(R, START_Y - PUCK_R - 12);
    c.stroke();
    c.setLineDash([]);

    // wax/silicone beads sprinkled on the surface
    for (let i = 0; i < 1400; i++) {
      const x = L + r() * (R - L), y = OFF_TOP_Y + r() * (H - OFF_TOP_Y);
      const rad = 0.35 + r() * 0.8;
      c.beginPath();
      c.arc(x, y, rad, 0, Math.PI * 2);
      c.fillStyle = `rgba(255,252,240,${(0.2 + r() * 0.4).toFixed(2)})`;
      c.fill();
    }

    // lacquer: reflections of two overhead lamps + a long glossy streak
    c.globalCompositeOperation = 'screen';
    for (const ly of [H * 0.28, H * 0.72]) {
      const g = c.createRadialGradient(CX, ly, 10, CX, ly, 260);
      g.addColorStop(0, 'rgba(255,245,220,0.35)');
      g.addColorStop(1, 'rgba(255,245,220,0)');
      c.fillStyle = g;
      c.fillRect(L, ly - 260, R - L, 520);
    }
    const streak = c.createLinearGradient(L, 0, R, 0);
    streak.addColorStop(0, 'rgba(255,255,255,0)');
    streak.addColorStop(0.36, 'rgba(255,255,255,0)');
    streak.addColorStop(0.42, 'rgba(255,255,255,0.12)');
    streak.addColorStop(0.48, 'rgba(255,255,255,0)');
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = streak;
    c.fillRect(L, OFF_TOP_Y, R - L, H);
    c.globalCompositeOperation = 'source-over';
    // edge darkening where the playfield meets the bumpers
    const edge = c.createLinearGradient(L, 0, R, 0);
    edge.addColorStop(0, 'rgba(60,30,5,0.35)');
    edge.addColorStop(0.06, 'rgba(60,30,5,0)');
    edge.addColorStop(0.94, 'rgba(60,30,5,0)');
    edge.addColorStop(1, 'rgba(60,30,5,0.35)');
    c.fillStyle = edge;
    c.fillRect(L, 0, R - L, H);
    c.restore();

    // --- black rubber bumpers along the playfield edges ---
    for (const x of [L - BUMPER, R]) {
      const g = c.createLinearGradient(x, 0, x + BUMPER, 0);
      g.addColorStop(0, '#0b0b0c');
      g.addColorStop(0.5, '#34363a');
      g.addColorStop(1, '#0b0b0c');
      c.fillStyle = g;
      c.fillRect(x, OFF_TOP_Y - 2, BUMPER, H - OFF_TOP_Y + 2);
    }
    // far-end lip: the drop-off into the end gutter
    const lip = c.createLinearGradient(0, OFF_TOP_Y - 6, 0, OFF_TOP_Y + 4);
    lip.addColorStop(0, 'rgba(0,0,0,0)');
    lip.addColorStop(0.6, 'rgba(0,0,0,0.6)');
    lip.addColorStop(1, 'rgba(255,230,180,0.35)');
    c.fillStyle = lip;
    c.fillRect(L, OFF_TOP_Y - 6, R - L, 10);

    // --- brass rail caps with screws, and the cabinet's inner edge ---
    for (const x of [FRAME - 4, W - FRAME]) {
      const g = c.createLinearGradient(x, 0, x + 4, 0);
      g.addColorStop(0, '#6d5320');
      g.addColorStop(0.5, '#f0d27a');
      g.addColorStop(1, '#6d5320');
      c.fillStyle = g;
      c.fillRect(x, 0, 4, H);
    }
    for (let y = 80; y < H - 20; y += 120) {
      for (const x of [FRAME / 2 - 2, W - FRAME / 2 + 2]) {
        const g = c.createRadialGradient(x - 1, y - 1, 0.5, x, y, 3.5);
        g.addColorStop(0, '#fff3c4');
        g.addColorStop(1, '#8a6a22');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, 3.2, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(60,40,10,0.8)';
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(x - 2, y);
        c.lineTo(x + 2, y);
        c.stroke();
      }
    }
    c.fillStyle = '#2a160a';
    c.fillRect(0, 0, W, FRAME - 6);

    // soft room vignette
    const vig = c.createRadialGradient(CX, H * 0.5, H * 0.3, CX, H * 0.5, H * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = vig;
    c.fillRect(0, 0, W, H);

    return tex;
  }

  global.SB = SB;
})(window);
