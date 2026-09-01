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

  const PLAYER_COLOR = { 1: '#4fd1c5', 2: '#f6ad55' };

  function zoneValueAt(y) {
    if (y >= ZONE_A.top && y < ZONE_A.bottom) return ZONE_A.value;
    if (y >= ZONE_B.top && y < ZONE_B.bottom) return ZONE_B.value;
    if (y >= ZONE_C.top && y < ZONE_C.bottom) return ZONE_C.value;
    return 0;
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
      pucks: [],           // {x,y,vx,vy,owner,id}
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
    _inputHandlers: null,

    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
    },

    resetMatch(p1Name, p2Name) {
      this.state = freshState();
      this.state.p1Name = p1Name || 'Player 1';
      this.state.p2Name = p2Name || 'Player 2';
    },

    addLog(msg) {
      this.state.log.push(msg);
      if (this.state.log.length > 50) this.state.log.shift();
    },

    // ---- Shooting (authority only) ----
    shoot(pull) {
      const s = this.state;
      if (s.simulating || s.matchOver) return false;
      const dx = pull.dx, dy = pull.dy;
      const dist = Math.min(Math.hypot(dx, dy), MAX_PULL);
      if (dist < 8) return false; // too weak, ignore as a mis-click
      const angle = Math.atan2(-dy, -dx); // shoot opposite of the pull
      // pick speed so the puck's natural friction-limited stopping distance
      // scales linearly with pull distance (constant deceleration: d = v^2 / 2a)
      const intendedDistance = dist * DIST_PER_PULL;
      const speed = Math.sqrt(2 * FRICTION_DECEL * intendedDistance);
      const owner = s.currentShooter;
      s.pucks.push({
        id: this._puckId++,
        x: s.aimX[owner],
        y: START_Y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        owner
      });
      s.simulating = true;
      s.shotsThisRound += 1;
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
        pucks: s.pucks.map(p => ({ id: p.id, x: p.x, y: p.y, owner: p.owner })),
        simulating: s.simulating, matchOver: s.matchOver, winner: s.winner,
        aimX: { 1: s.aimX[1], 2: s.aimX[2] },
        log: s.log.slice(-5)
      };
    },

    applyState(remote) {
      const s = this.state;
      Object.assign(s, remote);
    },

    // ---- Input (drag to shoot) ----
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
        // only count backward/downward pulls (shooting must go up the table)
        if (dy > 4) {
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

    // ---- Rendering ----
    render(opts) {
      opts = opts || {};
      const ctx = this.ctx;
      const s = this.state;
      ctx.clearRect(0, 0, W, H);

      // table wood background with rails
      ctx.fillStyle = '#7a4c2c';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#96633a';
      ctx.fillRect(RAIL_L, 0, RAIL_R - RAIL_L, H);
      // wood grain lines
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      for (let y = 0; y < H; y += 14) {
        ctx.beginPath(); ctx.moveTo(RAIL_L, y); ctx.lineTo(RAIL_R, y); ctx.stroke();
      }

      // zones
      [ZONE_A, ZONE_B, ZONE_C].forEach(z => {
        ctx.fillStyle = z.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(RAIL_L, z.top, RAIL_R - RAIL_L, z.bottom - z.top);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(z.value, (RAIL_L + RAIL_R) / 2, (z.top + z.bottom) / 2 + 8);
      });
      // off-the-end strip
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(RAIL_L, 0, RAIL_R - RAIL_L, OFF_TOP_Y);

      // foul line
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(RAIL_L, FOUL_LINE_Y);
      ctx.lineTo(RAIL_R, FOUL_LINE_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      // rail borders
      ctx.strokeStyle = '#4a2f1a';
      ctx.lineWidth = 6;
      ctx.strokeRect(RAIL_L, 0, RAIL_R - RAIL_L, H);

      // pucks
      for (const p of s.pucks) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_COLOR[p.owner];
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.stroke();
      }

      // ghost / next puck
      if (!s.matchOver && !s.simulating) {
        const owner = s.currentShooter;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(s.aimX[owner], START_Y, PUCK_R, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_COLOR[owner];
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // aim line while dragging
      if (this._dragging) {
        const owner = s.currentShooter;
        const d = this._dragging;
        const dx = d.curX - d.startX, dy = d.curY - d.startY;
        const dist = Math.min(Math.hypot(dx, dy), MAX_PULL);
        const angle = Math.atan2(dy, dx);
        const ex = s.aimX[owner] - Math.cos(angle) * dist * 2.4;
        const ey = START_Y - Math.sin(angle) * dist * 2.4;
        ctx.strokeStyle = PLAYER_COLOR[owner];
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s.aimX[owner], START_Y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, 6, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_COLOR[owner];
        ctx.fill();
      }

      if (opts.myTurn && !s.simulating && !s.matchOver) {
        ctx.strokeStyle = PLAYER_COLOR[s.currentShooter];
        ctx.lineWidth = 4;
        ctx.strokeRect(3, 3, W - 6, H - 6);
      }
    }
  };

  global.SB = SB;
})(window);
