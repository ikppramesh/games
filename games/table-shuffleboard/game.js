/* Table Shuffleboard - core physics, rules and rendering.
   Works standalone (practice mode) or driven by an authoritative host
   over the network (see net.js / main.js). Only the "authority"
   (the host, or the local player in practice mode) calls tick()/shoot();
   everyone else just calls applyState() + render(). */
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
  const ZONE_A = { top: 40, bottom: 140, value: 10, color: '#e05263' };
  const ZONE_B = { top: 140, bottom: 235, value: 8, color: '#f6ad55' };
  const ZONE_C = { top: 235, bottom: 335, value: 7, color: '#f4d35e' };
  const PUCKS_PER_PLAYER_PER_ROUND = 4;
  const WIN_SCORE = 21;
  const SETTLE_EPS = 6; // px/s
  const FLASH_MS = 900;

  const PLAYER_COLOR = { 1: '#4fd1c5', 2: '#f6ad55' };
  const PLAYER_COLOR_DARK = { 1: '#1f9c8f', 2: '#c97a2c' };
  const CONFETTI_COLORS = ['#4fd1c5', '#f6ad55', '#f4d35e', '#e05263', '#ffffff'];

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

    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
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
        return {
          x: (clientX - rect.left) * (W / rect.width),
          y: (clientY - rect.top) * (H / rect.height)
        };
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

      // --- table wood background ---
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#6e4326');
      bgGrad.addColorStop(1, '#5c3620');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      const playGrad = ctx.createLinearGradient(0, 0, 0, H);
      playGrad.addColorStop(0, '#a3703f');
      playGrad.addColorStop(0.5, '#93613a');
      playGrad.addColorStop(1, '#845632');
      ctx.fillStyle = playGrad;
      ctx.fillRect(RAIL_L, 0, RAIL_R - RAIL_L, H);

      // wood grain
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 1;
      for (let y = 6; y < H; y += 13) {
        ctx.beginPath(); ctx.moveTo(RAIL_L, y); ctx.lineTo(RAIL_R, y); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      [0.28, 0.55, 0.78].forEach(f => {
        const x = RAIL_L + (RAIL_R - RAIL_L) * f;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      });

      // --- zones ---
      [ZONE_A, ZONE_B, ZONE_C].forEach(z => {
        const zg = ctx.createLinearGradient(0, z.top, 0, z.bottom);
        zg.addColorStop(0, z.color);
        zg.addColorStop(1, shade(z.color, -18));
        ctx.fillStyle = zg;
        ctx.globalAlpha = 0.88;
        ctx.fillRect(RAIL_L, z.top, RAIL_R - RAIL_L, z.bottom - z.top);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(RAIL_L + 1, z.top + 1, RAIL_R - RAIL_L - 2, z.bottom - z.top - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(z.value, (RAIL_L + RAIL_R) / 2, (z.top + z.bottom) / 2 + 8);
      });
      // off-the-end strip
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(RAIL_L, 0, RAIL_R - RAIL_L, OFF_TOP_Y);

      // foul line
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(RAIL_L, FOUL_LINE_Y);
      ctx.lineTo(RAIL_R, FOUL_LINE_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      // vignette for depth
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = vg;
      ctx.fillRect(RAIL_L, 0, RAIL_R - RAIL_L, H);

      // --- rails (with bevel) ---
      const railGradL = ctx.createLinearGradient(0, 0, RAIL_L, 0);
      railGradL.addColorStop(0, '#3f2716');
      railGradL.addColorStop(0.5, '#7a4c2c');
      railGradL.addColorStop(1, '#4a2f1a');
      ctx.fillStyle = railGradL;
      ctx.fillRect(0, 0, RAIL_L, H);
      const railGradR = ctx.createLinearGradient(RAIL_R, 0, W, 0);
      railGradR.addColorStop(0, '#4a2f1a');
      railGradR.addColorStop(0.5, '#7a4c2c');
      railGradR.addColorStop(1, '#3f2716');
      ctx.fillStyle = railGradR;
      ctx.fillRect(RAIL_R, 0, W - RAIL_R, H);
      ctx.strokeStyle = '#2c1a0e';
      ctx.lineWidth = 3;
      ctx.strokeRect(RAIL_L, 0, RAIL_R - RAIL_L, H);

      // --- trails ---
      if (s.simulating) {
        for (const p of s.pucks) {
          const trail = this._trails[p.id];
          if (!trail) continue;
          for (let i = 0; i < trail.length; i++) {
            const t = trail[i];
            const age = (i + 1) / trail.length;
            ctx.beginPath();
            ctx.globalAlpha = age * 0.22;
            ctx.arc(t.x, t.y, PUCK_R * 0.7 * age, 0, Math.PI * 2);
            ctx.fillStyle = PLAYER_COLOR[p.owner];
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }

      // --- pucks (shadow + gradient body + landing glow) ---
      const now = Date.now();
      for (const p of s.pucks) {
        // shadow
        ctx.beginPath();
        ctx.ellipse(p.x + 3, p.y + 5, PUCK_R * 0.95, PUCK_R * 0.75, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();

        // landing glow
        if (p.flashUntil && now < p.flashUntil) {
          const t = 1 - (p.flashUntil - now) / FLASH_MS; // 0..1
          const ringR = PUCK_R + 6 + t * 22;
          ctx.beginPath();
          ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = PLAYER_COLOR[p.owner];
          ctx.globalAlpha = 0.6 * (1 - t);
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        const grad = ctx.createRadialGradient(p.x - PUCK_R * 0.35, p.y - PUCK_R * 0.4, PUCK_R * 0.15, p.x, p.y, PUCK_R);
        grad.addColorStop(0, shade(PLAYER_COLOR[p.owner], 30));
        grad.addColorStop(0.6, PLAYER_COLOR[p.owner]);
        grad.addColorStop(1, PLAYER_COLOR_DARK[p.owner]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.stroke();

        // specular highlight
        ctx.beginPath();
        ctx.arc(p.x - PUCK_R * 0.35, p.y - PUCK_R * 0.4, PUCK_R * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
      }

      // ghost / next puck (idle breathing animation)
      if (!s.matchOver && !s.simulating) {
        const owner = s.currentShooter;
        const pulse = Math.sin(performance.now() / 380) * 0.06 + 1;
        ctx.globalAlpha = 0.5 + Math.sin(performance.now() / 380) * 0.12;
        ctx.beginPath();
        ctx.arc(s.aimX[owner], START_Y, PUCK_R * pulse, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_COLOR[owner];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // aim line + power readout while dragging - matches the real shot exactly
      if (this._dragging) {
        const owner = s.currentShooter;
        const d = this._dragging;
        const aim = computeAim(d.curX - d.startX, d.curY - d.startY);
        const travel = aim.dist * DIST_PER_PULL;
        const ex = s.aimX[owner] + Math.cos(aim.angle) * travel;
        const ey = START_Y + Math.sin(aim.angle) * travel;

        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 3 + aim.power * 3;
        ctx.strokeStyle = PLAYER_COLOR[owner];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(s.aimX[owner], START_Y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // arrowhead
        ctx.beginPath();
        ctx.arc(ex, ey, 7, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_COLOR[owner];
        ctx.fill();

        // power readout
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(aim.power * 100)}%`, s.aimX[owner], START_Y + 40);
      }

      if (opts.myTurn && !s.simulating && !s.matchOver) {
        ctx.strokeStyle = PLAYER_COLOR[s.currentShooter];
        ctx.lineWidth = 4;
        ctx.strokeRect(3, 3, W - 6, H - 6);
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

  global.SB = SB;
})(window);
