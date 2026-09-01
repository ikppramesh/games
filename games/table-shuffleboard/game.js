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

  const PLAYER_COLOR = { 1: '#4fd1c5', 2: '#f6ad55' };
  const PLAYER_COLOR_DARK = { 1: '#1f9c8f', 2: '#c97a2c' };
  const CONFETTI_COLORS = ['#4fd1c5', '#f6ad55', '#f4d35e', '#e05263', '#ffffff'];

  // --- one-point perspective: the lane is full width at the near/shooter
  // end (y=H) and tapers toward FAR_SCALE width at the far end (y=0),
  // centered on CX. Only x is warped; y stays 1:1 with logical space. ---
  const CX = W / 2;
  const FAR_SCALE = 0.5;
  const RAIL_TOP = 16; // where the lane visually starts, near the top frame
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

  const SB = {
    W, H, RAIL_L, RAIL_R, PUCK_R, START_Y, FOUL_LINE_Y, OFF_TOP_Y,
    ZONE_A, ZONE_B, ZONE_C, PUCKS_PER_PLAYER_PER_ROUND, WIN_SCORE,
    PLAYER_COLOR,
    state: freshState(),
    authority: false,
    canvas: null,
    ctx: null,
    _puckId: 1,
    _dragging: null,      // {startX,startY,curX,curY}
    _trails: {},           // puckId -> [{x,y}]
    _confetti: [],
    _confettiTs: 0,
    _prevMatchOver: false,
    _tableTexture: null,

    init(canvas) {
      this.canvas = canvas;
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
    },

    addLog(msg) {
      this.state.log.push(msg);
      if (this.state.log.length > 50) this.state.log.shift();
    },

    // ---- Shooting (authority only) ----
    shoot(pull) {
      const s = this.state;
      if (s.simulating || s.matchOver) return false;
      const aim = computeAim(pull.dx, pull.dy);
      if (aim.dist < 8) return false; // too weak, ignore as a mis-click
      // pick speed so the puck's natural friction-limited stopping distance
      // scales linearly with pull distance (constant deceleration: d = v^2 / 2a)
      const intendedDistance = aim.dist * DIST_PER_PULL;
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
        this.addLog(s.winner ? `${s.winner === 1 ? s.p1Name : s.p2Name} wins!` : `It's a tie!`);
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
        // any drag with enough length counts as a shot attempt - direction
        // (toward the target or pulled back) doesn't matter, see computeAim()
        if (Math.hypot(dx, dy) > 8) {
          onShoot({ dx, dy });
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
      ctx.clearRect(0, 0, W, H);

      // baked perspective table: backdrop, frame, rails, lane, zones, foul line
      ctx.drawImage(this._tableTexture, 0, 0);

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
            ctx.globalAlpha = age * 0.22;
            ctx.arc(toScreenX(t.x, t.y), t.y, PUCK_R * 0.7 * age * scale, 0, Math.PI * 2);
            ctx.fillStyle = PLAYER_COLOR[p.owner];
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

        drawPuck(ctx, sx, p.y, r, PLAYER_COLOR[p.owner], PLAYER_COLOR_DARK[p.owner]);
      }

      // ghost / next puck (idle breathing animation)
      if (!s.matchOver && !s.simulating) {
        const owner = s.currentShooter;
        const scale = scaleAtY(START_Y);
        const pulse = Math.sin(performance.now() / 380) * 0.06 + 1;
        ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 380) * 0.12;
        drawPuck(ctx, toScreenX(s.aimX[owner], START_Y), START_Y, PUCK_R * scale * pulse, PLAYER_COLOR[owner], PLAYER_COLOR_DARK[owner]);
        ctx.globalAlpha = 1;
      }

      // aim line + power readout while dragging - matches the real shot exactly
      if (this._dragging) {
        const owner = s.currentShooter;
        const d = this._dragging;
        const aim = computeAim(d.curX - d.startX, d.curY - d.startY);
        const travel = aim.dist * DIST_PER_PULL;
        const lx0 = s.aimX[owner], ly0 = START_Y;
        const lx1 = lx0 + Math.cos(aim.angle) * travel;
        const ly1 = ly0 + Math.sin(aim.angle) * travel;

        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 3 + aim.power * 3;
        ctx.strokeStyle = PLAYER_COLOR[owner];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        const STEPS = 10;
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS;
          const lx = lx0 + (lx1 - lx0) * t;
          const ly = ly0 + (ly1 - ly0) * t;
          const px = toScreenX(lx, ly);
          if (i === 0) ctx.moveTo(px, ly); else ctx.lineTo(px, ly);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        const endScale = scaleAtY(ly1);
        const ex = toScreenX(lx1, ly1);
        ctx.beginPath();
        ctx.arc(ex, ly1, 7 * endScale, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_COLOR[owner];
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(aim.power * 100)}%`, toScreenX(lx0, ly0), ly0 + 40);
      }

      if (opts.myTurn && !s.simulating && !s.matchOver) {
        ctx.strokeStyle = PLAYER_COLOR[s.currentShooter];
        ctx.lineWidth = 4;
        ctx.strokeRect(9, 9, W - 18, H - 18);
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

  // A puck drawn as a lacquered weight: soft shadow, glossy gradient body,
  // dark rim, and a raised highlight lip - not a flat colored circle.
  function drawPuck(ctx, sx, sy, r, color, colorDark) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = r * 0.5;
    ctx.shadowOffsetX = r * 0.15;
    ctx.shadowOffsetY = r * 0.3;
    const grad = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.35, r * 0.1, sx, sy, r);
    grad.addColorStop(0, shade(color, 25));
    grad.addColorStop(0.55, color);
    grad.addColorStop(1, colorDark);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = Math.max(1.2, r * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();

    // raised highlight lip
    ctx.beginPath();
    ctx.ellipse(sx, sy - r * 0.35, r * 0.55, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fill();
  }

  // Bakes the whole table - dark backdrop, picture frame, tapering rails,
  // wood-grain lane, stained scoring zones, foul line - into an offscreen
  // canvas once, so render() can just blit it every frame instead of
  // redrawing dozens of gradients/paths at 60fps.
  function buildTableTexture() {
    const tex = document.createElement('canvas');
    tex.width = W; tex.height = H;
    const c = tex.getContext('2d');
    const FRAME = 22;

    // dark backdrop the lane recedes into
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#3a3f47');
    sky.addColorStop(0.35, '#22262d');
    sky.addColorStop(1, '#15171c');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    const glow = c.createRadialGradient(CX, RAIL_TOP + 10, 4, CX, RAIL_TOP + 10, 240);
    glow.addColorStop(0, 'rgba(255,244,220,0.16)');
    glow.addColorStop(1, 'rgba(255,244,220,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    const outerL = y => toScreenX(0, y);
    const outerR = y => toScreenX(W, y);
    const innerL = y => toScreenX(RAIL_L, y);
    const innerR = y => toScreenX(RAIL_R, y);

    function quad(p0, p1, p2, p3) {
      c.beginPath();
      c.moveTo(p0[0], p0[1]);
      c.lineTo(p1[0], p1[1]);
      c.lineTo(p2[0], p2[1]);
      c.lineTo(p3[0], p3[1]);
      c.closePath();
    }

    // --- rails (tapering trapezoids) ---
    const railGrad = c.createLinearGradient(0, RAIL_TOP, 0, H);
    railGrad.addColorStop(0, '#3a2312');
    railGrad.addColorStop(1, '#5c3a20');
    c.fillStyle = railGrad;
    quad([outerL(RAIL_TOP), RAIL_TOP], [innerL(RAIL_TOP), RAIL_TOP], [innerL(H), H], [outerL(H), H]);
    c.fill();
    quad([innerR(RAIL_TOP), RAIL_TOP], [outerR(RAIL_TOP), RAIL_TOP], [outerR(H), H], [innerR(H), H]);
    c.fill();
    c.strokeStyle = 'rgba(255,220,180,0.12)';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(innerL(RAIL_TOP), RAIL_TOP); c.lineTo(innerL(H), H); c.stroke();
    c.beginPath(); c.moveTo(innerR(RAIL_TOP), RAIL_TOP); c.lineTo(innerR(H), H); c.stroke();

    // --- play surface, clipped to its trapezoid ---
    c.save();
    quad([innerL(RAIL_TOP), RAIL_TOP], [innerR(RAIL_TOP), RAIL_TOP], [innerR(H), H], [innerL(H), H]);
    c.clip();

    const surfGrad = c.createLinearGradient(0, RAIL_TOP, 0, H);
    surfGrad.addColorStop(0, '#b58a52');
    surfGrad.addColorStop(0.5, '#c6975d');
    surfGrad.addColorStop(1, '#a97c46');
    c.fillStyle = surfGrad;
    c.fillRect(0, 0, W, H);

    // wood grain streaks (drawn in logical space, transformed per endpoint)
    for (let i = 0; i < 90; i++) {
      const lx = RAIL_L + Math.random() * (RAIL_R - RAIL_L);
      const ly0 = Math.random() * H;
      const len = 60 + Math.random() * 220;
      const ly1 = Math.min(H, ly0 + len);
      const jitter = (Math.random() - 0.5) * 18;
      const dark = Math.random() < 0.8;
      c.strokeStyle = dark ? `rgba(55,32,14,${0.04 + Math.random() * 0.07})` : `rgba(255,230,190,${0.03 + Math.random() * 0.05})`;
      c.lineWidth = 0.6 + Math.random() * 1.4;
      c.beginPath();
      c.moveTo(toScreenX(lx, ly0), ly0);
      c.quadraticCurveTo(toScreenX(lx + jitter, (ly0 + ly1) / 2), (ly0 + ly1) / 2, toScreenX(lx + jitter * 0.4, ly1), ly1);
      c.stroke();
    }
    // knots
    for (let i = 0; i < 3; i++) {
      const lx = RAIL_L + 40 + Math.random() * (RAIL_R - RAIL_L - 80);
      const ly = RAIL_TOP + 60 + Math.random() * (H - RAIL_TOP - 120);
      const kr = (4 + Math.random() * 5) * scaleAtY(ly);
      const kx = toScreenX(lx, ly);
      const kg = c.createRadialGradient(kx, ly, 0, kx, ly, kr * 2.4);
      kg.addColorStop(0, 'rgba(45,26,12,0.4)');
      kg.addColorStop(1, 'rgba(45,26,12,0)');
      c.fillStyle = kg;
      c.beginPath(); c.arc(kx, ly, kr * 2.4, 0, Math.PI * 2); c.fill();
    }
    // dust/wax speckle
    for (let i = 0; i < 220; i++) {
      const lx = RAIL_L + Math.random() * (RAIL_R - RAIL_L);
      const ly = RAIL_TOP + Math.random() * (H - RAIL_TOP);
      c.fillStyle = `rgba(255,240,210,${0.03 + Math.random() * 0.05})`;
      c.fillRect(toScreenX(lx, ly), ly, 1, 1);
    }

    // scoring zones, as tapering quads with a muted stain (grain shows through)
    [ZONE_A, ZONE_B, ZONE_C].forEach(z => {
      quad([innerL(z.top), z.top], [innerR(z.top), z.top], [innerR(z.bottom), z.bottom], [innerL(z.bottom), z.bottom]);
      c.save();
      c.clip();
      c.globalAlpha = 0.55;
      c.fillStyle = z.color;
      c.fillRect(0, z.top, W, z.bottom - z.top);
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.lineWidth = 1;
      quad([innerL(z.top) + 1, z.top + 1], [innerR(z.top) - 1, z.top + 1], [innerR(z.bottom) - 1, z.bottom - 1], [innerL(z.bottom) + 1, z.bottom - 1]);
      c.stroke();

      const midY = (z.top + z.bottom) / 2;
      const scale = scaleAtY(midY);
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.font = `bold ${Math.round(26 * scale)}px Georgia, serif`;
      c.textAlign = 'center';
      c.fillText(z.value, toScreenX(CX, midY), midY + 9 * scale);
    });

    // dark strip beyond the scoring line (off the far end)
    quad([innerL(RAIL_TOP), RAIL_TOP], [innerR(RAIL_TOP), RAIL_TOP], [innerR(OFF_TOP_Y), OFF_TOP_Y], [innerL(OFF_TOP_Y), OFF_TOP_Y]);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fill();

    // foul line
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 2;
    c.setLineDash([7, 7]);
    c.beginPath();
    c.moveTo(innerL(FOUL_LINE_Y), FOUL_LINE_Y);
    c.lineTo(innerR(FOUL_LINE_Y), FOUL_LINE_Y);
    c.stroke();
    c.setLineDash([]);

    c.restore(); // end play-surface clip

    // rail/lane outlines
    c.strokeStyle = '#1c1108';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(innerL(RAIL_TOP), RAIL_TOP); c.lineTo(innerL(H), H); c.stroke();
    c.beginPath(); c.moveTo(innerR(RAIL_TOP), RAIL_TOP); c.lineTo(innerR(H), H); c.stroke();
    c.beginPath(); c.moveTo(outerL(RAIL_TOP), RAIL_TOP); c.lineTo(outerL(H), H); c.stroke();
    c.beginPath(); c.moveTo(outerR(RAIL_TOP), RAIL_TOP); c.lineTo(outerR(H), H); c.stroke();
    c.beginPath(); c.moveTo(outerL(RAIL_TOP), RAIL_TOP); c.lineTo(outerR(RAIL_TOP), RAIL_TOP); c.stroke();

    // bolts along the rails
    c.fillStyle = 'rgba(15,9,4,0.85)';
    for (let ly = RAIL_TOP + 70; ly < H - 20; ly += 110) {
      const scale = scaleAtY(ly);
      const bxL = (outerL(ly) + innerL(ly)) / 2;
      const bxR = (outerR(ly) + innerR(ly)) / 2;
      [bxL, bxR].forEach(bx => {
        c.beginPath(); c.arc(bx, ly, 2.6 * scale, 0, Math.PI * 2); c.fill();
      });
    }

    // outer picture frame
    c.fillStyle = '#241408';
    c.fillRect(0, 0, W, FRAME);
    c.fillRect(0, H - FRAME, W, FRAME);
    c.fillRect(0, 0, FRAME, H);
    c.fillRect(W - FRAME, 0, FRAME, H);
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 1.5;
    c.strokeRect(FRAME, FRAME, W - FRAME * 2, H - FRAME * 2);
    c.strokeStyle = '#120a04';
    c.lineWidth = 3;
    c.strokeRect(FRAME - 1.5, FRAME - 1.5, W - (FRAME - 1.5) * 2, H - (FRAME - 1.5) * 2);

    return tex;
  }

  global.SB = SB;
})(window);
