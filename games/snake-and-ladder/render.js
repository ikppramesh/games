/* Snakes & Ladders board renderer - a vintage printed board (cream and green
   checks on aged card, a fold down the middle) with Gotham illustrations in
   some squares, 3D wooden ladders, and real snakes: scaled, shaded bodies,
   slit-pupil eyes and flicking tongues.

   Moves are animated from state.lastMove: the token hops square by square,
   climbs ladders, and when it lands on a snake's head the snake opens its
   jaws, swallows it, a bulge travels down the body, and the token comes out
   at the tail. Pure drawing code - main.js hands it the state. */
(function (global) {
  const W = 760, H = 760, MARGIN = 30, BOARD = W - MARGIN * 2, CELL = BOARD / 10;
  const SERIF = 'Georgia, "Times New Roman", Times, serif';
  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const CREAM = '#f2e8cf', GREEN = '#3f8d4e';

  const HOP_MS = 170;
  const SNAKE_SKINS = [
    { base: '#8fae3a', light: '#d9ec8a', dark: '#3f5a12', mark: '#4a3a12', belly: '#e8e3a0' },   // green python
    { base: '#c98b2e', light: '#f6d27e', dark: '#6b3f0c', mark: '#3b2106', belly: '#f3dca0' },   // golden cobra
    { base: '#6d7b86', light: '#c6d3dc', dark: '#2c353d', mark: '#1b2126', belly: '#dfe6ea' },   // grey viper
    { base: '#b8452f', light: '#f19a7a', dark: '#5c1a0e', mark: '#1f0d08', belly: '#f2c9a8' },   // red king snake
    { base: '#4f7f3a', light: '#a9d48a', dark: '#1f3a14', mark: '#e0c640', belly: '#dfe8a8' },   // banded green
    { base: '#8a6a45', light: '#d9bc92', dark: '#3d2a15', mark: '#2a1a0a', belly: '#ecdcc0' }    // brown rat snake
  ];

  let DPR = 1;
  let boardLayer = null, boardKey = null;
  let snakes = [];   // [{head, tail, pts, skin, phase}]
  let ladders = [];  // [{bottom, top}]

  function init(canvas) {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }

  // ---------- helpers ----------
  function makeLayer() {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    return { canvas, ctx };
  }

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function noiseCanvas(size, seed, spread) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const img = x.createImageData(size, size);
    const r = rng(seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (r() - 0.5) * spread;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  function texture(c, noise, alpha, op, rect) {
    c.save();
    c.globalAlpha = alpha;
    c.globalCompositeOperation = op || 'overlay';
    const pat = c.createPattern(noise, 'repeat');
    if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scaleSelf(1 / DPR, 1 / DPR));
    c.fillStyle = pat;
    c.fillRect(...(rect || [0, 0, W, H]));
    c.restore();
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

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function squareToRowCol(n) {
    const idx = n - 1;
    const row = Math.floor(idx / 10);
    let col = idx % 10;
    if (row % 2 === 1) col = 9 - col;
    return { row, col };
  }
  function cellTopLeft(row, col) { return { x: MARGIN + col * CELL, y: MARGIN + (9 - row) * CELL }; }
  function squareCenter(n) {
    const { row, col } = squareToRowCol(Math.max(1, Math.min(100, n)));
    const tl = cellTopLeft(row, col);
    return { x: tl.x + CELL / 2, y: tl.y + CELL / 2 };
  }

  // ---------- bat silhouettes (original artwork) ----------
  // right half of a scalloped-wing bat, as quadratic segments [cx, cy, x, y]
  const BAT_RIGHT = [
    [0.03, -0.2, 0.07, -0.34],   // ear
    [0.08, -0.2, 0.11, -0.13],
    [0.24, -0.13, 0.36, -0.3],   // wing leading edge
    [0.7, -0.34, 1.0, -0.04],
    [0.84, -0.02, 0.8, 0.14],    // scallops
    [0.66, 0.04, 0.56, 0.2],
    [0.42, 0.1, 0.33, 0.26],
    [0.2, 0.18, 0.1, 0.3],
    [0.04, 0.3, 0, 0.42]         // tail point
  ];
  function batPath(c, x, y, w) {
    const s = w / 2;
    c.beginPath();
    c.moveTo(x, y - 0.14 * s);
    for (const [cx, cy, px, py] of BAT_RIGHT) c.quadraticCurveTo(x + cx * s, y + cy * s, x + px * s, y + py * s);
    const pts = [[0, -0.14]].concat(BAT_RIGHT.map(([, , px, py]) => [px, py]));
    for (let i = BAT_RIGHT.length - 1; i >= 0; i--) {
      const [cx, cy] = BAT_RIGHT[i];
      const [px, py] = pts[i];
      c.quadraticCurveTo(x - cx * s, y + cy * s, x - px * s, y + py * s);
    }
    c.closePath();
  }

  function batEmblem(c, x, y, w, h) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.35)';
    c.shadowBlur = 3 * DPR;
    c.shadowOffsetY = 1.5 * DPR;
    c.beginPath();
    c.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    c.fillStyle = '#141414';
    c.fill();
    c.restore();
    c.beginPath();
    c.ellipse(x, y, w / 2 - 2.2, h / 2 - 2.2, 0, 0, Math.PI * 2);
    const g = c.createRadialGradient(x - w * 0.15, y - h * 0.25, 1, x, y, w / 2);
    g.addColorStop(0, '#ffe98a');
    g.addColorStop(1, '#f2b705');
    c.fillStyle = g;
    c.fill();
    batPath(c, x, y + h * 0.02, w * 0.84);
    c.fillStyle = '#141414';
    c.fill();
  }

  // ---------- Gotham illustrations for decorated squares ----------
  function nightPanel(c, x, y, s, draw) {
    c.save();
    roundRect(c, x, y, s, s, 6);
    c.clip();
    const sky = c.createLinearGradient(0, y, 0, y + s);
    sky.addColorStop(0, '#0b1230');
    sky.addColorStop(1, '#2a3560');
    c.fillStyle = sky;
    c.fillRect(x, y, s, s);
    draw();
    c.restore();
    roundRect(c, x + 0.5, y + 0.5, s - 1, s - 1, 6);
    c.strokeStyle = 'rgba(20,16,8,0.7)';
    c.lineWidth = 1.2;
    c.stroke();
  }

  function skyline(c, x, y, s, r) {
    c.fillStyle = '#05070f';
    let bx = x - 2;
    while (bx < x + s) {
      const bw = s * (0.1 + r() * 0.14), bh = s * (0.22 + r() * 0.42);
      c.fillRect(bx, y + s - bh, bw, bh);
      if (r() < 0.4) c.fillRect(bx + bw * 0.35, y + s - bh - s * 0.08, bw * 0.3, s * 0.08);
      c.fillStyle = 'rgba(255,214,110,0.85)';
      for (let wy = y + s - bh + 4; wy < y + s - 3; wy += 5) {
        for (let wx = bx + 2; wx < bx + bw - 2; wx += 4) if (r() < 0.28) c.fillRect(wx, wy, 1.6, 1.8);
      }
      c.fillStyle = '#05070f';
      bx += bw + 0.5;
    }
  }

  const ILLUSTRATIONS = {
    emblem(c, x, y, s) { batEmblem(c, x + s / 2, y + s / 2, s * 0.9, s * 0.56); },

    signal(c, x, y, s, r) {
      nightPanel(c, x, y, s, () => {
        c.save();
        c.globalCompositeOperation = 'screen';
        const beam = c.createLinearGradient(x + s * 0.2, y + s, x + s * 0.6, y + s * 0.3);
        beam.addColorStop(0, 'rgba(255,240,170,0.55)');
        beam.addColorStop(1, 'rgba(255,240,170,0.1)');
        c.fillStyle = beam;
        c.beginPath();
        c.moveTo(x + s * 0.16, y + s);
        c.lineTo(x + s * 0.28, y + s);
        c.lineTo(x + s * 0.86, y + s * 0.42);
        c.lineTo(x + s * 0.44, y + s * 0.2);
        c.closePath();
        c.fill();
        c.restore();
        c.beginPath();
        c.ellipse(x + s * 0.64, y + s * 0.3, s * 0.27, s * 0.17, -0.2, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,236,150,0.9)';
        c.fill();
        c.save();
        c.translate(x + s * 0.64, y + s * 0.3);
        c.rotate(-0.2);
        batPath(c, 0, 0, s * 0.42);
        c.fillStyle = '#111';
        c.fill();
        c.restore();
        skyline(c, x, y + s * 0.2, s, r);
      });
    },

    skyline(c, x, y, s, r) {
      nightPanel(c, x, y, s, () => {
        c.beginPath();
        c.arc(x + s * 0.72, y + s * 0.26, s * 0.14, 0, Math.PI * 2);
        c.fillStyle = '#f7f1d4';
        c.shadowColor = 'rgba(255,245,200,0.8)';
        c.shadowBlur = 8 * DPR;
        c.fill();
        c.shadowBlur = 0;
        batPath(c, x + s * 0.3, y + s * 0.22, s * 0.2);
        c.fillStyle = '#05070f';
        c.fill();
        skyline(c, x, y, s, r);
      });
    },

    bats(c, x, y, s) {
      nightPanel(c, x, y, s, () => {
        c.beginPath();
        c.arc(x + s * 0.5, y + s * 0.52, s * 0.3, 0, Math.PI * 2);
        const moon = c.createRadialGradient(x + s * 0.45, y + s * 0.45, 2, x + s * 0.5, y + s * 0.52, s * 0.3);
        moon.addColorStop(0, '#fffbe6');
        moon.addColorStop(1, '#e9d9a0');
        c.fillStyle = moon;
        c.fill();
        c.fillStyle = '#0b0b10';
        for (const [bx, by, bw] of [[0.42, 0.45, 0.34], [0.7, 0.28, 0.2], [0.24, 0.72, 0.16], [0.78, 0.74, 0.14]]) {
          batPath(c, x + s * bx, y + s * by, s * bw);
          c.fill();
        }
      });
    },

    batmobile(c, x, y, s) {
      nightPanel(c, x, y, s, () => {
        c.fillStyle = '#1a1d26';
        c.fillRect(x, y + s * 0.72, s, s * 0.28);
        c.strokeStyle = 'rgba(255,220,120,0.5)';
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(x, y + s * 0.86);
        c.lineTo(x + s, y + s * 0.86);
        c.stroke();
        c.setLineDash([]);
        drawBatmobileShape(c, x + s * 0.5, y + s * 0.62, s * 0.86, '#23262e', true);
      });
    },

    batarang(c, x, y, s) {
      c.save();
      c.translate(x + s * 0.55, y + s * 0.5);
      c.rotate(-0.35);
      c.strokeStyle = 'rgba(20,20,20,0.35)';
      c.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.moveTo(-s * 0.62, -s * 0.12 + i * s * 0.1);
        c.lineTo(-s * 0.34, -s * 0.12 + i * s * 0.1);
        c.stroke();
      }
      batPath(c, 0, 0, s * 0.72);
      const g = c.createLinearGradient(0, -s * 0.2, 0, s * 0.3);
      g.addColorStop(0, '#5a5f6b');
      g.addColorStop(1, '#101216');
      c.fillStyle = g;
      c.shadowColor = 'rgba(0,0,0,0.4)';
      c.shadowBlur = 3 * DPR;
      c.shadowOffsetY = 2 * DPR;
      c.fill();
      c.restore();
    },

    pow(c, x, y, s, r) {
      const words = ['POW!', 'BAM!', 'ZAP!', 'WHAM!'];
      const word = words[Math.floor(r() * words.length)];
      const cx = x + s / 2, cy = y + s / 2, spikes = 12;
      c.save();
      c.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const rad = (i % 2 ? 0.3 : 0.48) * s * (0.92 + r() * 0.16);
        c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.9);
      }
      c.closePath();
      c.fillStyle = '#e8352b';
      c.shadowColor = 'rgba(0,0,0,0.35)';
      c.shadowBlur = 3 * DPR;
      c.shadowOffsetY = 1.5 * DPR;
      c.fill();
      c.shadowBlur = 0;
      c.lineWidth = 1.5;
      c.strokeStyle = '#1b1b1b';
      c.stroke();
      c.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2 + 0.13;
        const rad = (i % 2 ? 0.2 : 0.32) * s;
        c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.9);
      }
      c.closePath();
      c.fillStyle = '#ffd92e';
      c.fill();
      c.font = `900 ${Math.round(s * (word.length > 4 ? 0.2 : 0.24))}px Impact, "Arial Black", ${SANS}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 2.5;
      c.strokeStyle = '#1b1b1b';
      c.translate(cx, cy);
      c.rotate(-0.12);
      c.strokeText(word, 0, 1);
      c.fillStyle = '#e8352b';
      c.fillText(word, 0, 1);
      c.restore();
    },

    cowl(c, x, y, s) {
      const cx = x + s / 2, top = y + s * 0.1;
      c.save();
      c.beginPath();
      c.moveTo(cx - s * 0.3, top + s * 0.3);
      c.lineTo(cx - s * 0.3, top);                  // left ear
      c.lineTo(cx - s * 0.18, top + s * 0.2);
      c.quadraticCurveTo(cx, top + s * 0.14, cx + s * 0.18, top + s * 0.2);
      c.lineTo(cx + s * 0.3, top);                  // right ear
      c.lineTo(cx + s * 0.3, top + s * 0.3);
      c.quadraticCurveTo(cx + s * 0.36, top + s * 0.62, cx + s * 0.16, top + s * 0.8);
      c.lineTo(cx - s * 0.16, top + s * 0.8);
      c.quadraticCurveTo(cx - s * 0.36, top + s * 0.62, cx - s * 0.3, top + s * 0.3);
      c.closePath();
      const g = c.createLinearGradient(cx - s * 0.3, top, cx + s * 0.3, top + s * 0.8);
      g.addColorStop(0, '#4a4f5c');
      g.addColorStop(1, '#0f1116');
      c.fillStyle = g;
      c.shadowColor = 'rgba(0,0,0,0.4)';
      c.shadowBlur = 3 * DPR;
      c.shadowOffsetY = 1.5 * DPR;
      c.fill();
      c.shadowBlur = 0;
      // skin-tone jaw + eyes
      c.beginPath();
      c.moveTo(cx - s * 0.2, top + s * 0.56);
      c.quadraticCurveTo(cx, top + s * 0.5, cx + s * 0.2, top + s * 0.56);
      c.quadraticCurveTo(cx + s * 0.16, top + s * 0.8, cx, top + s * 0.82);
      c.quadraticCurveTo(cx - s * 0.16, top + s * 0.8, cx - s * 0.2, top + s * 0.56);
      c.fillStyle = '#e2b48e';
      c.fill();
      c.fillStyle = '#fff';
      for (const side of [-1, 1]) {
        c.beginPath();
        c.moveTo(cx + side * s * 0.05, top + s * 0.4);
        c.lineTo(cx + side * s * 0.19, top + s * 0.37);
        c.lineTo(cx + side * s * 0.15, top + s * 0.44);
        c.closePath();
        c.fill();
      }
      c.strokeStyle = '#7a4a34';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx - s * 0.07, top + s * 0.71);
      c.quadraticCurveTo(cx, top + s * 0.69, cx + s * 0.07, top + s * 0.71);
      c.stroke();
      c.restore();
    }
  };
  const ILLUSTRATION_KINDS = Object.keys(ILLUSTRATIONS);

  // shared by the batmobile illustration and the player tokens
  function drawBatmobileShape(c, cx, cy, size, color, headlights) {
    const s = size / 40;
    c.save();
    c.translate(cx, cy);
    c.scale(s, s);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(0, 9, 18, 3, 0, 0, Math.PI * 2);
    c.fill();
    const body = c.createLinearGradient(0, -10, 0, 8);
    body.addColorStop(0, shadeHex(color, 70));
    body.addColorStop(0.45, color);
    body.addColorStop(1, shadeHex(color, -60));
    c.fillStyle = body;
    c.beginPath();
    c.moveTo(-19, 4);
    c.bezierCurveTo(-19, -1, -15, -5, -8, -5);
    c.bezierCurveTo(-5, -10, 5, -10, 8, -5);
    c.bezierCurveTo(14, -5, 19, -1, 19, 4);
    c.bezierCurveTo(19, 7, 15, 8, 10, 8);
    c.lineTo(-10, 8);
    c.bezierCurveTo(-15, 8, -19, 7, -19, 4);
    c.closePath();
    c.fill();
    // tail fins
    c.beginPath();
    c.moveTo(15, 0); c.lineTo(24, -7); c.lineTo(19, 3); c.closePath();
    c.fill();
    // canopy
    const glass = c.createLinearGradient(0, -10, 0, -5);
    glass.addColorStop(0, 'rgba(220,240,255,0.95)');
    glass.addColorStop(1, 'rgba(90,140,190,0.9)');
    c.fillStyle = glass;
    c.beginPath();
    c.moveTo(-6, -5); c.lineTo(-2, -9); c.lineTo(5, -9); c.lineTo(7, -5); c.closePath();
    c.fill();
    // body gloss
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(-15, -2); c.quadraticCurveTo(-8, -4, -3, -4);
    c.stroke();
    if (headlights) {
      c.fillStyle = '#ffe98a';
      c.beginPath();
      c.ellipse(-18, 2, 1.6, 1.2, 0, 0, Math.PI * 2);
      c.fill();
    }
    // wheels with hubs
    for (const wx of [-11, 11]) {
      c.fillStyle = '#0b0b0b';
      c.beginPath();
      c.arc(wx, 8, 3.8, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#8a8f99';
      c.beginPath();
      c.arc(wx, 8, 1.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function shadeHex(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 0xff, n & 0xff].map(v => Math.max(0, Math.min(255, v + amt)));
    return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
  }

  // ---------- ladders ----------
  function ladderGeom(bottom, top) {
    const a = squareCenter(bottom), b = squareCenter(top);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const half = CELL * 0.17;
    // rails run a little past the square centers so the ends sit inside the squares
    const ext = CELL * 0.18;
    return { a, b, ux, uy, nx, ny, half, len,
      p0: { x: a.x - ux * ext, y: a.y - uy * ext }, p1: { x: b.x + ux * ext, y: b.y + uy * ext } };
  }

  function strokeWood(c, x0, y0, x1, y1, width) {
    c.lineCap = 'round';
    c.strokeStyle = '#6b4712';
    c.lineWidth = width + 2;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = '#e9b52b';
    c.lineWidth = width;
    c.stroke();
    c.strokeStyle = 'rgba(255,240,170,0.75)';
    c.lineWidth = Math.max(1, width * 0.3);
    c.beginPath(); c.moveTo(x0 - 0.8, y0 - 0.8); c.lineTo(x1 - 0.8, y1 - 0.8); c.stroke();
  }

  function drawLadder(c, g, shadowOnly) {
    const rails = [1, -1].map(side => ({
      x0: g.p0.x + g.nx * g.half * side, y0: g.p0.y + g.ny * g.half * side,
      x1: g.p1.x + g.nx * g.half * side, y1: g.p1.y + g.ny * g.half * side
    }));
    const total = Math.hypot(g.p1.x - g.p0.x, g.p1.y - g.p0.y);
    const rungs = Math.max(3, Math.round(total / 20));
    if (shadowOnly) {
      c.lineCap = 'round';
      c.lineWidth = 6;
      for (const r of rails) { c.beginPath(); c.moveTo(r.x0, r.y0); c.lineTo(r.x1, r.y1); c.stroke(); }
      c.lineWidth = 4;
      for (let i = 1; i < rungs; i++) {
        const t = i / rungs;
        c.beginPath();
        c.moveTo(lerp(rails[0].x0, rails[0].x1, t), lerp(rails[0].y0, rails[0].y1, t));
        c.lineTo(lerp(rails[1].x0, rails[1].x1, t), lerp(rails[1].y0, rails[1].y1, t));
        c.stroke();
      }
      return;
    }
    for (let i = 1; i < rungs; i++) {
      const t = i / rungs;
      strokeWood(c, lerp(rails[0].x0, rails[0].x1, t), lerp(rails[0].y0, rails[0].y1, t),
        lerp(rails[1].x0, rails[1].x1, t), lerp(rails[1].y0, rails[1].y1, t), 3.4);
    }
    for (const r of rails) strokeWood(c, r.x0, r.y0, r.x1, r.y1, 5);
  }

  // ---------- snakes ----------
  // Sampled centre-line from the head (t = 0, the higher square) to the tail
  // (t = 1): a sine wave along the straight line between the two squares,
  // pinned to the square centres at both ends.
  function snakePath(head, tail, idx) {
    const a = squareCenter(head), b = squareCenter(tail);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const waves = Math.max(1, Math.round(len / 140));
    const amp = Math.min(CELL * 0.5, 14 + len * 0.1) * (idx % 2 ? 1 : -1);
    const R = CELL * 0.14;
    const n = Math.max(40, Math.ceil(len / 2.5));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7);
      const off = Math.sin(t * Math.PI * (waves + 0.5)) * amp * env;
      const neck = t < 0.05 ? 0.78 + 0.22 * (t / 0.05) : 1;
      pts.push({
        x: a.x + dx * t + nx * off,
        y: a.y + dy * t + ny * off,
        r: Math.max(1.3, R * neck * (1 - 0.85 * Math.pow(t, 1.5))),
        t
      });
    }
    // unit tangents (pointing from head towards tail)
    for (let i = 0; i < pts.length; i++) {
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      pts[i].tx = (q.x - p.x) / l;
      pts[i].ty = (q.y - p.y) / l;
    }
    return pts;
  }

  function stampBody(c, pts, skin, from, to, swell) {
    for (let i = to; i >= from; i--) {
      const p = pts[i];
      const r = p.r * (swell ? swell(p.t) : 1);
      const g = c.createRadialGradient(p.x - r * 0.35, p.y - r * 0.45, r * 0.1, p.x, p.y, r * 1.05);
      g.addColorStop(0, skin.light);
      g.addColorStop(0.45, skin.base);
      g.addColorStop(1, skin.dark);
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  function drawSnakeBody(c, sn) {
    const { pts, skin } = sn;
    stampBody(c, pts, skin, 0, pts.length - 1);
    // saddle markings along the back
    const spacing = CELL * 0.22;
    let acc = 0;
    for (let i = 3; i < pts.length - 2; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc < spacing) continue;
      acc = 0;
      const p = pts[i];
      if (p.r < 2.5) continue;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(Math.atan2(p.ty, p.tx));
      c.beginPath();
      c.ellipse(0, 0, p.r * 0.55, p.r * 0.72, 0, 0, Math.PI * 2);
      c.fillStyle = skin.mark;
      c.globalAlpha = 0.72;
      c.fill();
      c.beginPath();
      c.ellipse(0, 0, p.r * 0.25, p.r * 0.34, 0, 0, Math.PI * 2);
      c.fillStyle = skin.light;
      c.globalAlpha = 0.35;
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
    // overlapping scales
    c.strokeStyle = 'rgba(0,0,0,0.16)';
    c.lineWidth = 0.6;
    for (let i = 2; i < pts.length; i += 2) {
      const p = pts[i];
      if (p.r < 2.2) continue;
      const nx = -p.ty, ny = p.tx;
      for (let k = -0.7; k <= 0.71; k += 0.35) {
        const sx = p.x + nx * p.r * k, sy = p.y + ny * p.r * k;
        c.beginPath();
        c.arc(sx, sy, 1.4, Math.atan2(p.ty, p.tx) - 1.2, Math.atan2(p.ty, p.tx) + 1.2);
        c.stroke();
      }
    }
    // glossy highlight along the top of the body
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineCap = 'round';
    for (let i = 3; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      c.lineWidth = Math.max(0.5, p.r * 0.28);
      c.beginPath();
      c.moveTo(p.x - p.r * 0.32, p.y - p.r * 0.42);
      c.lineTo(q.x - q.r * 0.32, q.y - q.r * 0.42);
      c.stroke();
    }
  }

  // head faces away from the body; `open` 0..1 opens the jaws
  function drawSnakeHead(c, sn, now, open) {
    const p0 = sn.pts[0], p1 = sn.pts[Math.min(sn.pts.length - 1, 6)];
    const ang = Math.atan2(p0.y - p1.y, p0.x - p1.x);
    const R = CELL * 0.14, L = R * 2.9, Wd = R * 2.3;
    const { skin } = sn;
    c.save();
    c.translate(p0.x, p0.y);
    c.rotate(ang);

    // flicking forked tongue
    const cycle = (now / 1000 + sn.phase) % 2.6;
    const flick = open > 0.05 ? 0 : cycle < 0.45 ? Math.sin((cycle / 0.45) * Math.PI) : 0;
    if (flick > 0.02) {
      const tl = L * 0.35 + L * 0.5 * flick, wob = Math.sin(now / 35) * 1.2;
      c.strokeStyle = '#c4122f';
      c.lineWidth = 1.3;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(L * 0.5, 0);
      c.lineTo(L * 0.5 + tl, wob);
      c.moveTo(L * 0.5 + tl, wob);
      c.lineTo(L * 0.5 + tl + 4, wob - 3);
      c.moveTo(L * 0.5 + tl, wob);
      c.lineTo(L * 0.5 + tl + 4, wob + 3);
      c.stroke();
    }

    const headPath = (jaw) => {
      c.beginPath();
      c.moveTo(L * 0.62, 0);
      c.bezierCurveTo(L * 0.58, -Wd * 0.55 * jaw, -L * 0.15, -Wd * 0.62, -L * 0.42, -Wd * 0.3);
      c.quadraticCurveTo(-L * 0.52, 0, -L * 0.42, Wd * 0.3);
      c.bezierCurveTo(-L * 0.15, Wd * 0.62, L * 0.58, Wd * 0.55 * jaw, L * 0.62, 0);
      c.closePath();
    };
    const headFill = () => {
      const g = c.createRadialGradient(-L * 0.1, -Wd * 0.25, 1, 0, 0, L * 0.7);
      g.addColorStop(0, skin.light);
      g.addColorStop(0.5, skin.base);
      g.addColorStop(1, skin.dark);
      return g;
    };

    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = 5 * DPR;
    c.shadowOffsetX = 2 * DPR;
    c.shadowOffsetY = 3 * DPR;
    if (open > 0.02) {
      // gaping mouth: two jaws hinged at the back of the head
      const a = open * 0.55;
      c.fillStyle = '#7a1224';
      c.beginPath();
      c.moveTo(-L * 0.2, 0);
      c.lineTo(L * 0.62 * Math.cos(a), -L * 0.62 * Math.sin(a));
      c.lineTo(L * 0.62 * Math.cos(a), L * 0.62 * Math.sin(a));
      c.closePath();
      c.fill();
      c.shadowBlur = 0;
      for (const side of [-1, 1]) {
        c.save();
        c.translate(-L * 0.2, 0);
        c.rotate(side * a);
        c.translate(L * 0.2, 0);
        c.beginPath();
        c.moveTo(L * 0.62, 0);
        c.bezierCurveTo(L * 0.5, side * Wd * 0.45, -L * 0.15, side * Wd * 0.6, -L * 0.42, side * Wd * 0.3);
        c.quadraticCurveTo(-L * 0.5, 0, -L * 0.2, 0);
        c.closePath();
        c.fillStyle = headFill();
        c.fill();
        // fangs
        if (side === -1) {
          c.fillStyle = '#fbf6e4';
          for (const fx of [0.35, 0.48]) {
            c.beginPath();
            c.moveTo(L * fx, 0);
            c.lineTo(L * (fx + 0.04), Wd * 0.18);
            c.lineTo(L * (fx + 0.08), 0);
            c.closePath();
            c.fill();
          }
        }
        c.restore();
      }
    } else {
      headPath(1);
      c.fillStyle = headFill();
      c.fill();
      c.shadowBlur = 0;
      c.shadowOffsetX = c.shadowOffsetY = 0;
      // head markings + mouth line
      c.beginPath();
      c.ellipse(-L * 0.12, 0, L * 0.2, Wd * 0.16, 0, 0, Math.PI * 2);
      c.fillStyle = skin.mark;
      c.globalAlpha = 0.55;
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(L * 0.6, 0);
      c.quadraticCurveTo(L * 0.2, Wd * 0.12, -L * 0.15, Wd * 0.28);
      c.stroke();
    }
    c.shadowBlur = 0;
    c.shadowOffsetX = c.shadowOffsetY = 0;

    // eyes: amber with vertical slit pupils, plus nostrils
    for (const side of [-1, 1]) {
      const ex = L * 0.14, ey = side * Wd * (0.3 + open * 0.12);
      c.beginPath();
      c.ellipse(ex, ey, R * 0.42, R * 0.34, 0, 0, Math.PI * 2);
      c.fillStyle = '#f6c928';
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 0.7;
      c.stroke();
      c.beginPath();
      c.ellipse(ex, ey, R * 0.1, R * 0.3, 0, 0, Math.PI * 2);
      c.fillStyle = '#0b0b0b';
      c.fill();
      c.beginPath();
      c.arc(ex - R * 0.14, ey - R * 0.12, R * 0.08, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fill();
      if (open < 0.05) {
        c.beginPath();
        c.arc(L * 0.5, side * Wd * 0.1, 0.9, 0, Math.PI * 2);
        c.fillStyle = 'rgba(0,0,0,0.6)';
        c.fill();
      }
    }
    c.restore();
  }

  // ---------- static board (checks, art, numbers, ladders, snake bodies) ----------
  function buildBoard(state) {
    const L = makeLayer(), c = L.ctx;
    const key = boardKey;
    const r = rng(hash(key));

    // dark Gotham surround + lacquered frame
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1b1d24');
    bg.addColorStop(1, '#07080b');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    texture(c, noiseCanvas(128, 5, 50), 0.3);

    // board card with drop shadow
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.75)';
    c.shadowBlur = 16 * DPR;
    c.shadowOffsetY = 5 * DPR;
    c.fillStyle = CREAM;
    c.fillRect(MARGIN - 8, MARGIN - 8, BOARD + 16, BOARD + 16);
    c.restore();
    // printed red border band (like old cardboard boards)
    c.fillStyle = '#b3261e';
    c.fillRect(MARGIN - 8, MARGIN - 8, BOARD + 16, BOARD + 16);
    c.fillStyle = '#e9dcbc';
    c.fillRect(MARGIN - 2, MARGIN - 2, BOARD + 4, BOARD + 4);

    // checks
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const tl = cellTopLeft(row, col);
        c.fillStyle = (row + col) % 2 === 0 ? GREEN : CREAM;
        c.fillRect(tl.x, tl.y, CELL, CELL);
      }
    }

    // illustrations in some squares (kept off snake/ladder ends so those stay readable)
    const busy = new Set([1, 100]);
    for (const [a, b] of Object.entries(state.ladders || {})) { busy.add(+a); busy.add(+b); }
    for (const [a, b] of Object.entries(state.snakes || {})) { busy.add(+a); busy.add(+b); }
    const free = [];
    for (let n = 2; n < 100; n++) if (!busy.has(n)) free.push(n);
    for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
    const decorated = new Set(free.slice(0, 20));
    let k = Math.floor(r() * ILLUSTRATION_KINDS.length);
    for (const n of decorated) {
      const { row, col } = squareToRowCol(n);
      const tl = cellTopLeft(row, col);
      const kind = ILLUSTRATION_KINDS[k++ % ILLUSTRATION_KINDS.length];
      const inset = 8;
      ILLUSTRATIONS[kind](c, tl.x + inset, tl.y + inset + 4, CELL - inset * 2, r);
    }

    // square 100: the bat-signal finish
    {
      const tl = cellTopLeft(9, squareToRowCol(100).col);
      batEmblem(c, tl.x + CELL / 2, tl.y + CELL * 0.56, CELL * 0.78, CELL * 0.48);
    }

    // numbers: big and centred on plain squares, small in the corner on art squares
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let n = 1; n <= 100; n++) {
      const { row, col } = squareToRowCol(n);
      const tl = cellTopLeft(row, col);
      const onGreen = (row + col) % 2 === 0;
      if (n === 1) continue; // START square is drawn below
      if (decorated.has(n) || n === 100) {
        c.font = `bold 12px ${SERIF}`;
        c.fillStyle = onGreen ? '#f7f0da' : '#1e1e1e';
        c.fillText(n, tl.x + 11, tl.y + 10);
      } else {
        c.font = `${n === 1 ? 'bold ' : ''}22px ${SERIF}`;
        c.fillStyle = onGreen ? 'rgba(18,40,20,0.85)' : 'rgba(30,30,30,0.85)';
        c.fillText(n === 1 ? 'START' : n, tl.x + CELL / 2, tl.y + CELL / 2 + 1);
      }
    }
    // fix START size
    {
      const tl = cellTopLeft(0, 0);
      c.fillStyle = GREEN;
      c.fillRect(tl.x, tl.y, CELL, CELL);
      c.font = `bold 11px ${SERIF}`;
      c.fillStyle = '#f7f0da';
      c.fillText('1', tl.x + 10, tl.y + 10);
      c.font = `bold 13px ${SERIF}`;
      c.fillText('START', tl.x + CELL / 2, tl.y + CELL * 0.72);
      batPath(c, tl.x + CELL / 2, tl.y + CELL * 0.4, CELL * 0.5);
      c.fillStyle = '#111';
      c.fill();
    }

    // shadows of ladders and snakes, cast down-right onto the card
    const S = makeLayer();
    S.ctx.strokeStyle = '#000';
    S.ctx.fillStyle = '#000';
    for (const ld of ladders) drawLadder(S.ctx, ladderGeom(ld.bottom, ld.top), true);
    for (const sn of snakes) for (const p of sn.pts) { S.ctx.beginPath(); S.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); S.ctx.fill(); }
    c.save();
    c.globalAlpha = 0.28;
    c.drawImage(S.canvas, 4, 5, W, H);
    c.restore();

    for (const ld of ladders) drawLadder(c, ladderGeom(ld.bottom, ld.top), false);
    for (const sn of snakes) drawSnakeBody(c, sn);

    // aged paper: grain, a soft vignette, and the fold down the middle
    const area = [MARGIN - 8, MARGIN - 8, BOARD + 16, BOARD + 16];
    texture(c, noiseCanvas(256, 17, 90), 0.22, 'multiply', area);
    texture(c, noiseCanvas(64, 23, 60), 0.12, 'overlay', area);
    const vig = c.createRadialGradient(W / 2, H / 2, BOARD * 0.35, W / 2, H / 2, BOARD * 0.75);
    vig.addColorStop(0, 'rgba(120,80,20,0)');
    vig.addColorStop(1, 'rgba(90,55,10,0.28)');
    c.fillStyle = vig;
    c.fillRect(...area);
    const fold = c.createLinearGradient(W / 2 - 6, 0, W / 2 + 6, 0);
    fold.addColorStop(0, 'rgba(0,0,0,0)');
    fold.addColorStop(0.45, 'rgba(0,0,0,0.18)');
    fold.addColorStop(0.55, 'rgba(255,255,255,0.22)');
    fold.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fold;
    c.fillRect(W / 2 - 6, MARGIN - 8, 12, BOARD + 16);

    return L.canvas;
  }

  function setLayout(state) {
    const key = JSON.stringify([state.ladders || {}, state.snakes || {}]);
    if (key === boardKey && boardLayer) return false;
    boardKey = key;
    ladders = Object.entries(state.ladders || {}).map(([b, t]) => ({ bottom: +b, top: +t }));
    snakes = Object.entries(state.snakes || {}).map(([h, t], i) => {
      const r = rng(hash(key + h));
      return { head: +h, tail: +t, pts: snakePath(+h, +t, i), skin: SNAKE_SKINS[(i + Math.floor(r() * 6)) % SNAKE_SKINS.length], phase: r() * 2.6 };
    });
    boardLayer = buildBoard(state);
    return true;
  }

  // ---------- move animation ----------
  const anim = { ready: false, seq: 0, queue: [], cur: null, shown: {} }; // shown: playerId -> square

  function buildSegments(move) {
    const segs = [];
    if (move.event && move.event.type === 'bust') {
      segs.push({ kind: 'slide', from: move.from, to: 0, ms: 700 });
      return segs;
    }
    for (let sq = move.from; sq < move.landed; sq++) segs.push({ kind: 'hop', from: sq, to: sq + 1, ms: HOP_MS });
    const ev = move.event;
    if (ev && ev.type === 'ladder') {
      const d = Math.hypot(squareCenter(ev.to).x - squareCenter(ev.from).x, squareCenter(ev.to).y - squareCenter(ev.from).y);
      segs.push({ kind: 'climb', from: ev.from, to: ev.to, ms: 300 + d * 2.4 });
    } else if (ev && ev.type === 'snake') {
      const sn = snakes.find(s => s.head === ev.from);
      if (sn) {
        const len = sn.pts.reduce((acc, p, i) => i ? acc + Math.hypot(p.x - sn.pts[i - 1].x, p.y - sn.pts[i - 1].y) : 0, 0);
        segs.push({ kind: 'gulp', snake: sn, from: ev.from, to: ev.from, ms: 520 });
        segs.push({ kind: 'digest', snake: sn, from: ev.from, to: ev.to, ms: 900 + len * 2.2 });
        segs.push({ kind: 'emerge', snake: sn, from: ev.to, to: ev.to, ms: 420 });
      } else {
        segs.push({ kind: 'slide', from: ev.from, to: ev.to, ms: 700 });
      }
    }
    return segs;
  }

  function sync(state, now) {
    const lm = state.lastMove;
    if (setLayout(state) || !anim.ready) {
      // new board (or first sight): no animation, just place everyone
      anim.ready = true;
      anim.queue = [];
      anim.cur = null;
      anim.seq = lm ? lm.seq : 0;
      anim.shown = {};
    }
    if (lm && lm.seq > anim.seq) {
      if (lm.seq === anim.seq + 1) {
        const segs = buildSegments(lm);
        segs.forEach(s => { s.playerId = lm.playerId; });
        anim.queue.push(...segs);
        if (!(lm.playerId in anim.shown)) anim.shown[lm.playerId] = lm.from;
      } else {
        anim.queue = [];
        anim.cur = null;
        anim.shown = {};
      }
      anim.seq = lm.seq;
    }
    for (const p of state.players) {
      const pending = (anim.cur && anim.cur.playerId === p.id) || anim.queue.some(s => s.playerId === p.id);
      if (!pending) anim.shown[p.id] = p.pos;
    }
    // advance the queue
    while (true) {
      if (!anim.cur) {
        if (!anim.queue.length) break;
        anim.cur = anim.queue.shift();
        anim.cur.start = now;
      }
      if (now - anim.cur.start < anim.cur.ms) break;
      anim.shown[anim.cur.playerId] = anim.cur.to;
      const endedAt = anim.cur.start + anim.cur.ms;
      anim.cur = null;
      if (anim.queue.length) { anim.cur = anim.queue.shift(); anim.cur.start = endedAt; }
    }
  }

  function remainingMs(now) {
    let ms = anim.queue.reduce((s, x) => s + x.ms, 0);
    if (anim.cur) ms += Math.max(0, anim.cur.ms - (now - anim.cur.start));
    return ms;
  }

  // where (and how) to draw the player being animated
  function animatedToken(now) {
    const s = anim.cur;
    if (!s) return null;
    const t = clamp01((now - s.start) / s.ms);
    const a = squareCenter(s.from), b = squareCenter(s.to);
    switch (s.kind) {
      case 'hop': {
        const e = easeInOut(t);
        return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) - Math.sin(Math.PI * t) * 16, scale: 1 + Math.sin(Math.PI * t) * 0.12 };
      }
      case 'climb': {
        const e = easeInOut(t);
        return { x: lerp(a.x, b.x, e) + Math.sin(t * Math.PI * 10) * 1.5, y: lerp(a.y, b.y, e), scale: 1 };
      }
      case 'slide': {
        const e = easeInOut(t);
        return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), scale: 1, alpha: 1 - Math.sin(Math.PI * t) * 0.4 };
      }
      case 'gulp': {
        // pulled into the open mouth
        const head = s.snake.pts[0];
        const e = easeInOut(clamp01((t - 0.25) / 0.75));
        return { x: lerp(a.x, head.x, e), y: lerp(a.y, head.y, e), scale: 1 - e * 0.85, alpha: 1 - e };
      }
      case 'digest': return { hidden: true };
      case 'emerge': {
        const tip = s.snake.pts[s.snake.pts.length - 1];
        const e = easeOut(t);
        return { x: lerp(tip.x, b.x, e), y: lerp(tip.y, b.y, e) - Math.sin(Math.PI * t) * 10, scale: 0.35 + 0.65 * e, alpha: 0.3 + 0.7 * e };
      }
    }
    return null;
  }

  function mouthOpen(sn, now) {
    const s = anim.cur;
    if (!s || s.snake !== sn) return 0;
    const t = clamp01((now - s.start) / s.ms);
    if (s.kind === 'gulp') return Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5) * (t > 0.85 ? (1 - t) / 0.15 : 1);
    return 0;
  }

  // the swallowed token as a bulge sliding down the body
  function drawDigestBulge(c, now, color) {
    const s = anim.cur;
    if (!s || s.kind !== 'digest') return;
    const t = easeInOut(clamp01((now - s.start) / s.ms));
    const pts = s.snake.pts;
    const center = Math.round(t * (pts.length - 1));
    const spread = Math.max(6, Math.round(pts.length * 0.07));
    const from = Math.max(0, center - spread), to = Math.min(pts.length - 1, center + spread);
    stampBody(c, pts, s.snake.skin, from, to, (u) => 1 + 0.75 * Math.exp(-Math.pow((u - t) / 0.035, 2)));
    const p = pts[center];
    // the swallowed Batmobile's colour shows faintly through the skin
    c.save();
    c.globalAlpha = 0.28;
    c.beginPath();
    c.arc(p.x, p.y, p.r * 1.2, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.restore();
    c.beginPath();
    c.arc(p.x - p.r * 0.4, p.y - p.r * 0.6, p.r * 0.45, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.fill();
  }

  // ---------- main draw ----------
  function draw(ctx, state, myId, now) {
    if (!state) {
      if (!boardLayer) setLayout({ ladders: {}, snakes: {} });
      ctx.drawImage(boardLayer, 0, 0, W, H);
      return false;
    }
    sync(state, now);
    ctx.drawImage(boardLayer, 0, 0, W, H);

    const mover = anim.cur && state.players.find(p => p.id === anim.cur.playerId);
    if (mover) drawDigestBulge(ctx, now, mover.color);
    for (const sn of snakes) drawSnakeHead(ctx, sn, now, mouthOpen(sn, now));

    // tokens: resting ones share squares politely, the moving one is drawn last
    const current = state.stage === 'playing' ? state.players[state.currentIndex] : null;
    const resting = state.players.filter(p => !(anim.cur && anim.cur.playerId === p.id));
    const bySquare = {};
    for (const p of resting) (bySquare[anim.shown[p.id] || 0] = bySquare[anim.shown[p.id] || 0] || []).push(p);
    const offsets = [[0, 0], [-15, -12], [15, -12], [-15, 12], [15, 12]];
    const pulse = 0.5 + 0.5 * Math.sin(now / 280);
    Object.entries(bySquare).forEach(([sq, group]) => {
      const c0 = squareCenter(Number(sq) || 1);
      group.forEach((p, i) => {
        const off = group.length > 1 ? offsets[i + 1] || [0, 0] : [0, 0];
        drawToken(ctx, c0.x + off[0], c0.y + off[1] + 4, p, p.id === myId, current && current.id === p.id && !anim.cur ? pulse : -1, 1, 1);
      });
    });
    if (mover) {
      const at = animatedToken(now);
      if (at && !at.hidden) drawToken(ctx, at.x, at.y + 4, mover, mover.id === myId, -1, at.scale, at.alpha == null ? 1 : at.alpha);
    }

    if (state.stage === 'finished' && state.winner && !anim.cur && !anim.queue.length) drawWinner(ctx, state);
    return true;
  }

  function drawToken(c, x, y, p, isMe, pulse, scale, alpha) {
    c.save();
    c.globalAlpha = alpha;
    // coloured halo so each player is easy to spot
    c.beginPath();
    c.ellipse(x, y + 7 * scale, 17 * scale, 6 * scale, 0, 0, Math.PI * 2);
    c.fillStyle = p.color;
    c.globalAlpha = alpha * (pulse >= 0 ? 0.45 + 0.4 * pulse : 0.45);
    if (pulse >= 0) { c.shadowColor = p.color; c.shadowBlur = (8 + 10 * pulse) * DPR; }
    c.fill();
    c.shadowBlur = 0;
    c.globalAlpha = alpha;
    drawBatmobileShape(c, x, y, 34 * scale, p.color, true);
    if (isMe && scale > 0.6) {
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x - 4, y - 16 * scale);
      c.lineTo(x + 4, y - 16 * scale);
      c.lineTo(x, y - 11 * scale);
      c.closePath();
      c.fill();
      c.stroke();
    }
    c.restore();
  }

  function drawWinner(c, state) {
    const w = state.players.find(p => p.id === state.winner);
    const text = `${w ? w.name : 'Someone'} saved Gotham!`;
    c.save();
    c.fillStyle = 'rgba(5,6,10,0.55)';
    c.fillRect(0, 0, W, H);
    const bw = 380, bh = 150, x = W / 2 - bw / 2, y = H / 2 - bh / 2;
    c.shadowColor = 'rgba(0,0,0,0.7)';
    c.shadowBlur = 24 * DPR;
    roundRect(c, x, y, bw, bh, 16);
    c.fillStyle = '#111318';
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = '#f2b705';
    c.lineWidth = 2;
    c.stroke();
    batEmblem(c, W / 2, y + 48, 120, 64);
    c.fillStyle = '#ffe98a';
    c.font = `bold 22px ${SANS}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, W / 2, y + 112);
    c.restore();
  }

  global.SNLRender = { init, draw, remainingMs, W, H };
})(window);
