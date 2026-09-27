/* Poker table renderer - draws a casino-style table on the canvas: padded
   leather rail with stitching, lacquered wood trim, textured felt under an
   overhead lamp, vector-drawn playing cards (real pip layouts and court
   cards), clay chip stacks broken into denominations, and deal / bet / pot
   animations. Pure drawing code - main.js hands it the personalized state. */
(function (global) {
  const W = 900, H = 620, CX = W / 2, CY = H / 2 - 10;
  const RAIL = { rx: 428, ry: 262 };
  const TRIM = { rx: 381, ry: 216 };
  const FELT = { rx: 368, ry: 203 };
  const SEAT = { rx: 370, ry: 205 };
  const DECK = { x: CX, y: CY - 130 };

  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const SERIF = 'Georgia, "Times New Roman", Times, serif';
  const RED = '#c21a2b', BLACK = '#15161a';

  const COMMUNITY = { w: 50, h: 70, gap: 7 };
  const DEAL_MS = 520, BET_MS = 320, SWEEP_MS = 420, AWARD_MS = 750;

  const DENOMS = [
    { v: 500, base: '#5b2a86', spot: '#f3e9ff', inlay: '#7a49ad' },
    { v: 100, base: '#1d1d21', spot: '#f1f1f1', inlay: '#3a3a42' },
    { v: 25,  base: '#15703a', spot: '#f4f4f4', inlay: '#258a4d' },
    { v: 5,   base: '#b3131f', spot: '#f7f7f7', inlay: '#cc2f3c' },
    { v: 1,   base: '#ecebe4', spot: '#2a5bd7', inlay: '#f8f8f3' }
  ];
  const CHIP = { r: 10, ry: 5.6, t: 2.8, maxPerStack: 8 };

  let DPR = 1;
  let bgLayer = null;
  const sprites = new Map();

  function init(canvas) {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bgLayer = null;
    sprites.clear();
    return ctx;
  }

  // ---------- small helpers ----------
  function makeLayer(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * DPR));
    canvas.height = Math.max(1, Math.ceil(h * DPR));
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    return { canvas, ctx };
  }

  function cached(key, w, h, paint) {
    let s = sprites.get(key);
    if (!s) {
      const L = makeLayer(w, h);
      paint(L.ctx, w, h);
      s = L.canvas;
      sprites.set(key, s);
    }
    return s;
  }

  // seeded PRNG so textures look identical on every load
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
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

  // fill the current clip with a noise pattern (one noise pixel per device pixel)
  function texture(c, noise, alpha, op) {
    c.save();
    c.globalAlpha = alpha;
    c.globalCompositeOperation = op || 'overlay';
    const pat = c.createPattern(noise, 'repeat');
    if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') {
      pat.setTransform(new DOMMatrix().scaleSelf(1 / DPR, 1 / DPR));
    }
    c.fillStyle = pat;
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  function ellipse(c, e, inset) {
    const d = inset || 0;
    c.ellipse(CX, CY, e.rx - d, e.ry - d, 0, 0, Math.PI * 2);
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

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 0xff, n & 0xff];
  }
  function shade(hex, amt) {
    const [r, g, b] = hexRgb(hex).map(v => Math.max(0, Math.min(255, v + amt)));
    return `rgb(${r},${g},${b})`;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function fitText(c, text, x, y, maxW) {
    const w = c.measureText(text).width;
    if (w <= maxW) { c.fillText(text, x, y); return; }
    c.save();
    c.translate(x, y);
    c.scale(maxW / w, 1);
    c.fillText(text, 0, 0);
    c.restore();
  }

  function ellipsize(c, text, maxW) {
    if (c.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

  // ---------- static background: room, rail, trim, felt, lighting ----------
  function buildBackground() {
    const L = makeLayer(W, H), c = L.ctx;

    // the room - dark and warm, lit from a lamp over the table
    const room = c.createRadialGradient(CX, CY - 40, 60, CX, CY, 640);
    room.addColorStop(0, '#3b2a1e');
    room.addColorStop(0.55, '#1a120c');
    room.addColorStop(1, '#060403');
    c.fillStyle = room;
    c.fillRect(0, 0, W, H);
    texture(c, noiseCanvas(128, 91, 60), 0.35, 'overlay');

    // table casts a soft shadow on the floor
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.85)';
    c.shadowBlur = 46 * DPR;
    c.shadowOffsetY = 20 * DPR;
    c.beginPath(); ellipse(c, RAIL);
    c.fillStyle = '#120a06';
    c.fill();
    c.restore();

    // padded leather rail
    c.save();
    c.beginPath(); ellipse(c, RAIL); ellipse(c, TRIM);
    c.clip('evenodd');
    const leather = c.createLinearGradient(0, CY - RAIL.ry, 0, CY + RAIL.ry);
    leather.addColorStop(0, '#4d2e1d');
    leather.addColorStop(0.5, '#2d180e');
    leather.addColorStop(1, '#190c05');
    c.fillStyle = leather;
    c.fillRect(0, 0, W, H);
    // tube shading: dark where the padding curves away, lit on the crown
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const hump = Math.sin(Math.PI * t);
      c.beginPath();
      c.ellipse(CX, CY, lerp(TRIM.rx, RAIL.rx, t), lerp(TRIM.ry, RAIL.ry, t), 0, 0, Math.PI * 2);
      c.lineWidth = 2.2;
      c.strokeStyle = `rgba(0,0,0,${(0.6 * Math.pow(1 - hump, 2)).toFixed(3)})`;
      c.stroke();
    }
    const sheen = c.createLinearGradient(0, CY - RAIL.ry, 0, CY + RAIL.ry);
    sheen.addColorStop(0, 'rgba(255,226,190,0.55)');
    sheen.addColorStop(0.4, 'rgba(255,226,190,0.10)');
    sheen.addColorStop(1, 'rgba(255,226,190,0.03)');
    c.strokeStyle = sheen;
    for (let k = 0; k < 6; k++) {
      c.globalAlpha = 0.22;
      c.lineWidth = 18 - k * 3;
      c.beginPath();
      c.ellipse(CX, CY, lerp(TRIM.rx, RAIL.rx, 0.45), lerp(TRIM.ry, RAIL.ry, 0.42), 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
    texture(c, noiseCanvas(128, 7, 110), 0.4, 'overlay');
    c.restore();

    // stitching along both edges of the padding
    c.save();
    c.setLineDash([3.4, 3]);
    c.lineWidth = 1;
    for (const inset of [7, -6]) {
      const e = inset > 0 ? RAIL : TRIM;
      c.strokeStyle = 'rgba(0,0,0,0.55)';
      c.beginPath(); c.ellipse(CX, CY + 0.8, e.rx - inset, e.ry - inset, 0, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = 'rgba(222,186,138,0.5)';
      c.beginPath(); c.ellipse(CX, CY, e.rx - inset, e.ry - inset, 0, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    c.beginPath(); ellipse(c, RAIL, 0.5);
    c.strokeStyle = 'rgba(255,230,200,0.10)';
    c.lineWidth = 1;
    c.stroke();

    // lacquered wood trim (the "racetrack")
    c.save();
    c.beginPath(); ellipse(c, TRIM); ellipse(c, FELT);
    c.clip('evenodd');
    const wood = c.createLinearGradient(CX - TRIM.rx, 0, CX + TRIM.rx, 0);
    wood.addColorStop(0, '#5a3312');
    wood.addColorStop(0.22, '#8f5d2c');
    wood.addColorStop(0.5, '#6d4119');
    wood.addColorStop(0.78, '#9c6734');
    wood.addColorStop(1, '#5a3312');
    c.fillStyle = wood;
    c.fillRect(0, 0, W, H);
    const r = rng(42);
    for (let i = 0; i < 90; i++) {
      const t = r();
      const a0 = r() * Math.PI * 2, len = 0.2 + r() * 1.3;
      c.beginPath();
      c.ellipse(CX, CY, lerp(FELT.rx, TRIM.rx, t), lerp(FELT.ry, TRIM.ry, t), 0, a0, a0 + len);
      c.strokeStyle = r() < 0.6 ? `rgba(38,18,4,${(0.18 + r() * 0.3).toFixed(2)})` : `rgba(255,212,150,${(0.05 + r() * 0.12).toFixed(2)})`;
      c.lineWidth = 0.4 + r() * 0.9;
      c.stroke();
    }
    const lac = c.createLinearGradient(0, CY - TRIM.ry, 0, CY + TRIM.ry);
    lac.addColorStop(0, 'rgba(255,240,210,0.40)');
    lac.addColorStop(0.3, 'rgba(255,240,210,0.06)');
    lac.addColorStop(0.7, 'rgba(0,0,0,0.05)');
    lac.addColorStop(1, 'rgba(0,0,0,0.40)');
    c.fillStyle = lac;
    c.fillRect(0, 0, W, H);
    c.restore();
    c.beginPath(); ellipse(c, TRIM);
    c.strokeStyle = 'rgba(0,0,0,0.65)';
    c.lineWidth = 1.5;
    c.stroke();
    c.beginPath(); ellipse(c, TRIM, 2.5);
    c.strokeStyle = 'rgba(255,232,195,0.28)';
    c.lineWidth = 1;
    c.stroke();

    // felt
    c.save();
    c.beginPath(); ellipse(c, FELT);
    c.clip();
    const felt = c.createRadialGradient(CX, CY - 40, 20, CX, CY, FELT.rx);
    felt.addColorStop(0, '#26965f');
    felt.addColorStop(0.55, '#177a4a');
    felt.addColorStop(1, '#0a4d2f');
    c.fillStyle = felt;
    c.fillRect(0, 0, W, H);
    texture(c, noiseCanvas(256, 3, 80), 0.28, 'overlay');
    texture(c, noiseCanvas(48, 11, 40), 0.10, 'overlay');
    // printed betting line + logo
    c.beginPath(); ellipse(c, { rx: FELT.rx - 58, ry: FELT.ry - 50 });
    c.strokeStyle = 'rgba(255,232,160,0.17)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = 'rgba(255,232,160,0.16)';
    c.font = `600 15px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('T E X A S   H O L D ’ E M', CX, CY + 76);
    c.font = `italic 11px ${SERIF}`;
    c.fillText('♠  ♥  ♦  ♣', CX, CY + 96);
    // the rail throws a soft shadow onto the felt
    c.beginPath();
    c.rect(-50, -50, W + 100, H + 100);
    ellipse(c, FELT);
    c.shadowColor = 'rgba(0,0,0,0.8)';
    c.shadowBlur = 26 * DPR;
    c.shadowOffsetY = 7 * DPR;
    c.fillStyle = '#000';
    c.fill('evenodd');
    c.restore();

    // overhead lamp + vignette
    c.save();
    c.globalCompositeOperation = 'screen';
    const lamp = c.createRadialGradient(CX, CY - 70, 20, CX, CY - 20, 520);
    lamp.addColorStop(0, 'rgba(255,236,190,0.17)');
    lamp.addColorStop(0.5, 'rgba(255,236,190,0.04)');
    lamp.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = lamp;
    c.fillRect(0, 0, W, H);
    c.restore();
    const vig = c.createRadialGradient(CX, CY, 250, CX, CY, 620);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vig;
    c.fillRect(0, 0, W, H);

    return L.canvas;
  }

  // ---------- suits (vector, so they never fall back to emoji glyphs) ----------
  function isRed(suit) { return suit === 'H' || suit === 'D'; }

  function suitPath(c, suit) {
    c.beginPath();
    if (suit === 'H') {
      c.moveTo(0, 0.45);
      c.bezierCurveTo(-0.1, 0.3, -0.5, 0.1, -0.5, -0.16);
      c.bezierCurveTo(-0.5, -0.42, -0.18, -0.52, 0, -0.26);
      c.bezierCurveTo(0.18, -0.52, 0.5, -0.42, 0.5, -0.16);
      c.bezierCurveTo(0.5, 0.1, 0.1, 0.3, 0, 0.45);
    } else if (suit === 'D') {
      c.moveTo(0, -0.5);
      c.quadraticCurveTo(0.16, -0.2, 0.4, 0);
      c.quadraticCurveTo(0.16, 0.2, 0, 0.5);
      c.quadraticCurveTo(-0.16, 0.2, -0.4, 0);
      c.quadraticCurveTo(-0.16, -0.2, 0, -0.5);
    } else if (suit === 'S') {
      c.moveTo(0, -0.5);
      c.bezierCurveTo(0.1, -0.32, 0.5, -0.14, 0.5, 0.1);
      c.bezierCurveTo(0.5, 0.32, 0.2, 0.38, 0.05, 0.22);
      c.quadraticCurveTo(0.08, 0.42, 0.2, 0.5);
      c.lineTo(-0.2, 0.5);
      c.quadraticCurveTo(-0.08, 0.42, -0.05, 0.22);
      c.bezierCurveTo(-0.2, 0.38, -0.5, 0.32, -0.5, 0.1);
      c.bezierCurveTo(-0.5, -0.14, -0.1, -0.32, 0, -0.5);
    } else {
      for (const [x, y] of [[0, -0.25], [-0.25, 0.07], [0.25, 0.07]]) {
        c.moveTo(x + 0.21, y);
        c.arc(x, y, 0.21, 0, Math.PI * 2);
      }
      c.moveTo(0.12, 0.02);
      c.arc(0, 0.02, 0.12, 0, Math.PI * 2);
      c.moveTo(0.04, 0.08);
      c.quadraticCurveTo(0.08, 0.42, 0.2, 0.5);
      c.lineTo(-0.2, 0.5);
      c.quadraticCurveTo(-0.08, 0.42, -0.04, 0.08);
      c.closePath();
    }
  }

  function drawSuit(c, suit, x, y, size, flip, color) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);
    c.scale(size, size);
    suitPath(c, suit);
    c.fillStyle = color || (isRed(suit) ? RED : BLACK);
    c.fill();
    c.restore();
  }

  // ---------- cards ----------
  const PIPS = {
    2: [[1, 0], [1, 1]],
    3: [[1, 0], [1, 0.5], [1, 1]],
    4: [[0, 0], [2, 0], [0, 1], [2, 1]],
    5: [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
    6: [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
    7: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
    8: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
    9: [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, 0.5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
    10: [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]]
  };

  function rankLabel(r) { return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[r] || String(r); }

  function cardBase(c, w, h) {
    const r = Math.max(3, w * 0.08);
    roundRect(c, 0.5, 0.5, w - 1, h - 1, r);
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#eee8da');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.3)';
    c.stroke();
    return r;
  }

  function crown(c, x, y, cw, ch, rank, trim) {
    c.beginPath();
    if (rank === 13) {
      c.moveTo(x - cw / 2, y + ch / 2);
      c.lineTo(x - cw / 2, y - ch * 0.3);
      c.lineTo(x - cw / 4, y + ch * 0.05);
      c.lineTo(x, y - ch / 2);
      c.lineTo(x + cw / 4, y + ch * 0.05);
      c.lineTo(x + cw / 2, y - ch * 0.3);
      c.lineTo(x + cw / 2, y + ch / 2);
    } else if (rank === 12) {
      c.moveTo(x - cw / 2, y + ch / 2);
      c.quadraticCurveTo(x - cw / 2, y - ch / 2, x, y - ch / 2);
      c.quadraticCurveTo(x + cw / 2, y - ch / 2, x + cw / 2, y + ch / 2);
    } else {
      c.moveTo(x - cw / 2, y + ch / 2);
      c.lineTo(x - cw / 2, y - ch * 0.05);
      c.quadraticCurveTo(x, y - ch * 0.35, x + cw / 2, y - ch * 0.05);
      c.lineTo(x + cw / 2, y + ch / 2);
    }
    c.closePath();
    c.fillStyle = '#e2b340';
    c.fill();
    c.lineWidth = 0.8;
    c.strokeStyle = trim;
    c.stroke();
    c.fillStyle = trim;
    for (const dx of [-cw / 4, 0, cw / 4]) {
      c.beginPath();
      c.arc(x + dx, y + ch * 0.25, Math.max(0.8, cw * 0.06), 0, Math.PI * 2);
      c.fill();
    }
  }

  function paintFace(c, w, h, card) {
    cardBase(c, w, h);
    const color = isRed(card.suit) ? RED : BLACK;
    const label = rankLabel(card.rank);
    c.fillStyle = color;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    if (w < 42) {
      // compact deck style for small opponent cards: big index + big suit
      c.font = `bold ${Math.round(h * 0.34)}px ${SERIF}`;
      fitText(c, label, w * 0.3, h * 0.34, w * 0.5);
      drawSuit(c, card.suit, w * 0.3, h * 0.49, h * 0.18);
      drawSuit(c, card.suit, w * 0.64, h * 0.74, h * 0.36);
      return;
    }

    // corner indices, top-left and (rotated) bottom-right
    for (const flip of [false, true]) {
      c.save();
      if (flip) { c.translate(w, h); c.rotate(Math.PI); }
      c.fillStyle = color;
      c.font = `bold ${Math.round(h * 0.19)}px ${SERIF}`;
      fitText(c, label, w * 0.13, h * 0.2, w * 0.2);
      drawSuit(c, card.suit, w * 0.13, h * 0.29, h * 0.1);
      c.restore();
    }

    if (card.rank === 14) {
      drawSuit(c, card.suit, w / 2, h / 2, h * (card.suit === 'S' ? 0.46 : 0.36));
      if (card.suit === 'S') {
        c.beginPath();
        c.ellipse(w / 2, h / 2 + h * 0.02, w * 0.3, h * 0.27, 0, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(0,0,0,0.25)';
        c.lineWidth = 0.6;
        c.stroke();
      }
    } else if (card.rank >= 11) {
      const fx = w * 0.23, fy = h * 0.15, fw = w * 0.54, fh = h * 0.7;
      const trim = isRed(card.suit) ? '#b0182a' : '#1f3f8f';
      roundRect(c, fx, fy, fw, fh, 2);
      const fg = c.createLinearGradient(fx, fy, fx + fw, fy + fh);
      fg.addColorStop(0, '#fcecc0');
      fg.addColorStop(0.5, '#f3d488');
      fg.addColorStop(1, '#e6bb5e');
      c.fillStyle = fg;
      c.fill();
      c.lineWidth = 1.1;
      c.strokeStyle = trim;
      c.stroke();
      c.save();
      roundRect(c, fx, fy, fw, fh, 2);
      c.clip();
      for (const flip of [false, true]) {
        c.save();
        if (flip) { c.translate(w, h); c.rotate(Math.PI); }
        crown(c, w / 2, fy + fh * 0.15, fw * 0.5, fh * 0.14, card.rank, trim);
        c.fillStyle = trim;
        c.font = `bold ${Math.round(fh * 0.27)}px ${SERIF}`;
        c.fillText(label, w / 2, fy + fh * 0.46);
        drawSuit(c, card.suit, fx + fw * 0.18, fy + fh * 0.1, fh * 0.1);
        c.restore();
      }
      c.beginPath();
      c.moveTo(fx, fy + fh * 0.56);
      c.lineTo(fx + fw, fy + fh * 0.44);
      c.strokeStyle = trim;
      c.globalAlpha = 0.5;
      c.lineWidth = 0.7;
      c.stroke();
      c.restore();
      roundRect(c, fx + 2, fy + 2, fw - 4, fh - 4, 1.5);
      c.strokeStyle = trim;
      c.globalAlpha = 0.35;
      c.lineWidth = 0.6;
      c.stroke();
      c.globalAlpha = 1;
    } else {
      const cols = [w * 0.34, w * 0.5, w * 0.66];
      const top = h * 0.21, bottom = h * 0.79;
      for (const [col, row] of PIPS[card.rank]) {
        drawSuit(c, card.suit, cols[col], lerp(top, bottom, row), h * 0.14, row > 0.5);
      }
    }
  }

  function paintBack(c, w, h) {
    const r = cardBase(c, w, h);
    const m = Math.max(2.5, w * 0.08);
    roundRect(c, m, m, w - 2 * m, h - 2 * m, r * 0.6);
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#a3202d');
    g.addColorStop(1, '#690e18');
    c.fillStyle = g;
    c.fill();
    c.save();
    c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 0.7;
    const step = Math.max(4, w * 0.14);
    c.beginPath();
    for (let i = -h; i < w + h; i += step) {
      c.moveTo(i, 0); c.lineTo(i + h, h);
      c.moveTo(i, h); c.lineTo(i + h, 0);
    }
    c.stroke();
    c.beginPath();
    c.ellipse(w / 2, h / 2, w * 0.2, h * 0.15, 0, 0, Math.PI * 2);
    c.fillStyle = '#7a1420';
    c.fill();
    c.strokeStyle = 'rgba(240,200,120,0.85)';
    c.lineWidth = 0.8;
    c.stroke();
    drawSuit(c, 'S', w / 2, h / 2, h * 0.14, false, '#f0c878');
    c.restore();
    roundRect(c, m, m, w - 2 * m, h - 2 * m, r * 0.6);
    c.strokeStyle = 'rgba(240,200,120,0.7)';
    c.lineWidth = 0.8;
    c.stroke();
  }

  function cardSprite(card, w, h, faceDown) {
    if (faceDown || !card) return cached(`back-${w}x${h}`, w, h, (c) => paintBack(c, w, h));
    return cached(`${card.rank}${card.suit}-${w}x${h}`, w, h, (c) => paintFace(c, w, h, card));
  }

  function drawCard(ctx, card, cx, cy, w, h, opts) {
    const o = opts || {};
    const s = o.scale || 1;
    ctx.save();
    ctx.translate(cx, cy);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(Math.max(0.001, (o.scaleX == null ? 1 : o.scaleX) * s), s);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = (o.lift ? 12 : 5) * DPR;
    ctx.shadowOffsetX = 1 * DPR;
    ctx.shadowOffsetY = (o.lift ? 7 : 2.5) * DPR;
    ctx.drawImage(cardSprite(card, w, h, o.faceDown), -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // ---------- chips ----------
  function paintChip(c, d, variant) {
    const { r, ry, t } = CHIP;
    const x = r + 1, y = ry + 1;
    const off = variant * 0.35 + Math.PI / 6;

    // edge band
    c.save();
    c.beginPath();
    c.moveTo(x + r, y);
    c.ellipse(x, y + t, r, ry, 0, 0, Math.PI);
    c.lineTo(x - r, y);
    c.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
    c.closePath();
    c.fillStyle = shade(d.base, -40);
    c.fill();
    c.clip();
    c.fillStyle = d.spot;
    for (let k = 0; k < 6; k++) {
      const a = off + k * Math.PI / 3;
      const s = Math.sin(a);
      if (s <= 0.1) continue;
      const sw = r * 0.36 * s;
      c.fillRect(x + r * Math.cos(a) - sw / 2, y + ry * s, sw, t);
    }
    c.restore();

    // top face
    c.beginPath();
    c.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    const g = c.createRadialGradient(x - r * 0.35, y - ry * 0.5, 1, x, y, r * 1.1);
    g.addColorStop(0, shade(d.base, 45));
    g.addColorStop(1, d.base);
    c.fillStyle = g;
    c.fill();
    c.fillStyle = d.spot;
    for (let k = 0; k < 6; k++) {
      const a = off + k * Math.PI / 3;
      c.beginPath();
      c.ellipse(x, y, r, ry, 0, a - 0.22, a + 0.22);
      c.ellipse(x, y, r * 0.74, ry * 0.74, 0, a + 0.22, a - 0.22, true);
      c.closePath();
      c.fill();
    }
    c.beginPath();
    c.ellipse(x, y, r * 0.56, ry * 0.56, 0, 0, Math.PI * 2);
    c.fillStyle = d.inlay;
    c.fill();
    c.setLineDash([1.1, 1.1]);
    c.strokeStyle = d.spot;
    c.globalAlpha = 0.7;
    c.lineWidth = 0.6;
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
    c.beginPath();
    c.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 0.6;
    c.stroke();
  }

  function chipSprite(di, variant) {
    const { r, ry, t } = CHIP;
    return cached(`chip-${di}-${variant}`, 2 * r + 2, 2 * ry + t + 2, (c) => paintChip(c, DENOMS[di], variant));
  }

  function breakdown(amount) {
    const stacks = [];
    let left = Math.max(0, Math.floor(amount));
    for (let i = 0; i < DENOMS.length && stacks.length < 4; i++) {
      const n = Math.floor(left / DENOMS[i].v);
      if (!n) continue;
      left -= n * DENOMS[i].v;
      stacks.push([i, Math.min(CHIP.maxPerStack, n)]);
    }
    return stacks;
  }

  // (x, y) is where the stacks rest on the felt
  function drawChips(ctx, x, y, amount, opts) {
    if (!amount) return;
    const o = opts || {};
    const stacks = breakdown(amount);
    const { r, ry, t } = CHIP;
    const span = r * 2.15;
    const x0 = x - (stacks.length - 1) * span / 2;
    stacks.forEach(([di, count], si) => {
      const sx = x0 + si * span, sy = y + (si % 2) * 2;
      ctx.beginPath();
      ctx.ellipse(sx + 1.5, sy + 2, r + 1.5, ry + 1.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      for (let i = 0; i < count; i++) {
        const jitter = ((i * 37 + si * 11) % 7 - 3) * 0.18;
        const top = sy - t - i * t;
        ctx.drawImage(chipSprite(di, (i + si) % 3), sx - r - 1 + jitter, top - ry - 1, 2 * r + 2, 2 * ry + t + 2);
      }
    });
    if (o.label !== false) {
      const text = fmt(amount);
      ctx.font = `700 11px ${SANS}`;
      const tw = ctx.measureText(text).width + 12;
      const ly = y + 13;
      roundRect(ctx, x - tw / 2, ly - 8, tw, 16, 8);
      ctx.fillStyle = 'rgba(10,10,12,0.72)';
      ctx.fill();
      ctx.fillStyle = '#ffe7a3';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, ly + 0.5);
    }
  }

  function drawDealerButton(ctx, x, y) {
    const r = 11, ry = 7, t = 3;
    ctx.beginPath();
    ctx.ellipse(x + 1.5, y + t + 1.5, r + 1, ry + 1, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.ellipse(x, y + t, r, ry, 0, 0, Math.PI);
    ctx.lineTo(x - r, y);
    ctx.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
    ctx.fillStyle = '#a9a79f';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - 4, y - 3, 1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#d9d7ce');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y + 0.5);
    ctx.scale(1, ry / r);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `bold 13px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', 0, 0);
    ctx.restore();
  }

  // ---------- players ----------
  function drawAvatar(ctx, x, y, r, color, initials, o) {
    if (o.glow) {
      ctx.save();
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = o.glowSize * DPR;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = o.glow;
      ctx.fill();
      ctx.restore();
    }
    // bezel with a drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8 * DPR;
    ctx.shadowOffsetY = 3 * DPR;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    const bez = ctx.createLinearGradient(0, y - r, 0, y + r);
    bez.addColorStop(0, '#f1e8d2');
    bez.addColorStop(0.5, '#a8987a');
    bez.addColorStop(1, '#4f4536');
    ctx.fillStyle = bez;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const face = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r * 1.1);
    face.addColorStop(0, shade(color, 55));
    face.addColorStop(0.55, color);
    face.addColorStop(1, shade(color, -80));
    ctx.fillStyle = face;
    ctx.fill();

    // glossy highlight
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.5, r * 0.78, r * 0.48, 0, 0, Math.PI * 2);
    const gloss = ctx.createLinearGradient(0, y - r, 0, y);
    gloss.addColorStop(0, 'rgba(255,255,255,0.45)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fill();
    ctx.restore();

    ctx.font = `700 ${Math.round(r * 0.62)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText(initials, x, y + 1.5);
    ctx.fillStyle = '#fff';
    ctx.fillText(initials, x, y);
  }

  // "Computer 3" -> "C3", "Ramesh Inampudi" -> "RI", "You" -> "YO"
  function initialsOf(name) {
    const words = String(name || '?').trim().split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function drawNameplate(ctx, x, y, name, sub, subColor) {
    const w = 120, h = 36;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 8 * DPR;
    ctx.shadowOffsetY = 3 * DPR;
    roundRect(ctx, x - w / 2, y, w, h, 9);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(38,36,40,0.95)');
    g.addColorStop(1, 'rgba(10,10,12,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    roundRect(ctx, x - w / 2 + 0.5, y + 0.5, w - 1, h - 1, 9);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px ${SANS}`;
    ctx.fillStyle = '#f4f1ea';
    ctx.fillText(ellipsize(ctx, name, w - 14), x, y + 12);
    ctx.font = `700 12px ${SANS}`;
    ctx.fillStyle = subColor;
    ctx.fillText(sub, x, y + 26);
  }

  function actionStyle(text) {
    const t = text.toLowerCase();
    if (t.includes('all-in')) return '#dc2626';
    if (t.startsWith('fold')) return '#6b7280';
    if (t.startsWith('check') || t.startsWith('call')) return '#2563eb';
    if (t.startsWith('bet') || t.startsWith('raise')) return '#d97706';
    return '#4b5563';
  }

  function drawBadge(ctx, x, y, text, color) {
    ctx.font = `800 9.5px ${SANS}`;
    const label = text.toUpperCase();
    const w = ctx.measureText(label).width + 12;
    roundRect(ctx, x - w / 2, y - 7.5, w, 15, 7.5);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);
  }

  // ---------- layout ----------
  function seatPositions(n) {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const angle = Math.PI / 2 + k * (2 * Math.PI / n);
      pts.push({ x: CX + SEAT.rx * Math.cos(angle), y: CY + SEAT.ry * Math.sin(angle) });
    }
    return pts;
  }

  function betSpot(pos) {
    return { x: lerp(pos.x, CX, 0.5), y: lerp(pos.y, CY, 0.58) };
  }

  const POT_SPOT = { x: CX - 36, y: CY - 44 };

  // ---------- animation bookkeeping ----------
  const anim = { hand: null, seen: new Map(), bets: new Map(), flying: [] };

  function firstSeen(key, now, delay) {
    let s = anim.seen.get(key);
    if (s === undefined) { s = now + (delay || 0); anim.seen.set(key, s); }
    return s;
  }

  // draws a card sliding in from the deck (optionally flipping face up);
  // returns true while still moving
  function dealtCard(ctx, key, card, x, y, w, h, o, now, delay) {
    const start = firstSeen(key, now, delay);
    const p = (now - start) / DEAL_MS;
    if (p < 0) return true;
    if (p >= 1) { drawCard(ctx, card, x, y, w, h, o); return false; }
    const e = easeOut(clamp01(p / 0.65));
    const opts = Object.assign({}, o, {
      rot: (o.rot || 0) + (1 - e) * -0.9,
      scale: lerp(0.75, 1, e),
      lift: true
    });
    if (o.flip && !o.faceDown) {
      if (p < 0.65) opts.faceDown = true;
      else {
        const f = (p - 0.65) / 0.35;
        opts.scaleX = Math.abs(Math.cos(Math.PI * f));
        opts.faceDown = f < 0.5;
      }
    }
    drawCard(ctx, card, lerp(DECK.x, x, e), lerp(DECK.y, y, e), w, h, opts);
    return true;
  }

  // ---------- main draw ----------
  function draw(ctx, state, myId, seatColors, now) {
    if (!bgLayer) bgLayer = buildBackground();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgLayer, 0, 0, W, H);

    if (!state || !state.players || !state.players.length) {
      ctx.fillStyle = 'rgba(255,240,210,0.75)';
      ctx.font = `600 20px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for players…', CX, CY);
      return false;
    }

    if (anim.hand !== state.handNumber) {
      anim.hand = state.handNumber;
      anim.seen.clear();
      anim.bets.clear();
      anim.flying = [];
    }

    let busy = false;
    const n = state.players.length;
    const me = state.players.find(p => p.id === myId);
    const mySeat = me ? me.seat : 0;
    const positions = seatPositions(n);
    const posOf = (p) => positions[(p.seat - mySeat + n) % n];
    const showdown = state.stage === 'showdown';
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);

    // community card slots (printed on the felt) + cards
    const cw = COMMUNITY.w, ch = COMMUNITY.h, gap = COMMUNITY.gap;
    const startX = CX - (cw * 5 + gap * 4) / 2 + cw / 2;
    let fresh = 0;
    for (let i = 0; i < 5; i++) {
      const x = startX + i * (cw + gap);
      const card = state.community[i];
      if (!card) {
        roundRect(ctx, x - cw / 2, CY - ch / 2, cw, ch, 4);
        ctx.strokeStyle = 'rgba(255,240,200,0.14)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        continue;
      }
      const key = `cc${i}-${card.rank}${card.suit}`;
      const delay = anim.seen.has(key) ? 0 : (fresh++) * 140;
      busy = dealtCard(ctx, key, card, x, CY, cw, ch, { flip: true }, now, delay) || busy;
    }

    // chips already collected into the pot (current street's bets stay in front of players)
    const liveBets = state.players.reduce((s, p) => s + (p.betThisRound || 0), 0);
    const collected = showdown ? 0 : Math.max(0, state.pot - liveBets);
    if (collected > 0) drawChips(ctx, POT_SPOT.x, POT_SPOT.y, collected, { label: false });
    if (state.pot > 0) {
      const text = `POT  ${fmt(state.pot)}`;
      ctx.font = `700 12px ${SANS}`;
      const tw = ctx.measureText(text).width + 18;
      const px = collected > 0 ? POT_SPOT.x + 44 + tw / 2 - 12 : CX;
      roundRect(ctx, px - tw / 2, POT_SPOT.y - 12, tw, 20, 10);
      ctx.fillStyle = 'rgba(8,8,10,0.72)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,130,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffe7a3';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px, POT_SPOT.y - 1.5);
    }

    // bets in front of each player (slide out from the seat when placed,
    // swept into the pot when the street ends)
    state.players.forEach((p) => {
      const pos = posOf(p);
      const spot = betSpot(pos);
      const prev = anim.bets.get(p.id);
      const amount = showdown ? 0 : (p.betThisRound || 0);
      if (amount > 0) {
        if (!prev || prev.amount !== amount) {
          const from = prev && prev.amount > 0 ? spot : pos;
          anim.bets.set(p.id, { amount, start: now, from });
        }
        const b = anim.bets.get(p.id);
        const t = clamp01((now - b.start) / BET_MS);
        if (t < 1) busy = true;
        const e = easeOut(t);
        drawChips(ctx, lerp(b.from.x, spot.x, e), lerp(b.from.y, spot.y, e), amount, { label: t >= 1 });
      } else if (prev && prev.amount > 0) {
        anim.flying.push({ from: spot, to: POT_SPOT, amount: prev.amount, start: now, ms: SWEEP_MS });
        anim.bets.delete(p.id);
      }
    });

    // seats
    state.players.forEach((p) => {
      const pos = posOf(p);
      const isMe = p.id === myId;
      const color = seatColors[p.seat % seatColors.length];
      const r = isMe ? 30 : 26;
      const out = p.folded || p.bustedOut;
      const isWinner = showdown && state.winners.some(w => w.id === p.id);

      // hole cards, fanned and tucked just behind the avatar
      if (p.holeCards && p.holeCards.length && !p.bustedOut && !p.folded) {
        const w = isMe ? 50 : 36, h = isMe ? 70 : 50;
        const spread = isMe ? 17 : 11;
        const cy = pos.y - r - h / 2 + (isMe ? 6 : 8);
        const faceUp = isMe || showdown;
        p.holeCards.forEach((card, k) => {
          const side = k === 0 ? -1 : 1;
          busy = dealtCard(ctx, `h-${p.id}-${k}`, card, pos.x + side * spread, cy - (isWinner ? 6 : 0), w, h,
            { rot: side * 0.11, faceDown: !faceUp || !card, flip: isMe }, now, (p.seat * 2 + k) * 60) || busy;
        });
      }

      ctx.save();
      if (out) ctx.globalAlpha = 0.5;
      let glow = null, glowSize = 0;
      if (isWinner) { glow = 'rgba(255,210,80,0.95)'; glowSize = 22; }
      else if (state.actingId === p.id) { glow = `rgba(255,224,138,${(0.55 + 0.4 * pulse).toFixed(2)})`; glowSize = 10 + 14 * pulse; busy = true; }
      drawAvatar(ctx, pos.x, pos.y, r, color, initialsOf(p.name), { glow, glowSize });

      const sub = p.bustedOut ? 'Out' : p.folded ? 'Folded' : p.allIn ? 'All-in' : fmt(p.chips);
      const subColor = p.bustedOut || p.folded ? '#9ca3af' : p.allIn ? '#f87171' : '#f5c451';
      const plateY = pos.y + r - 6;
      drawNameplate(ctx, pos.x, plateY, p.name + (isMe ? ' (you)' : ''), sub, subColor);
      ctx.restore();

      if (isWinner) {
        const w = state.winners.find(x => x.id === p.id);
        drawBadge(ctx, pos.x, plateY + 43, w.handName ? `Wins · ${w.handName}` : 'Winner', '#b8860b');
      } else if (!showdown && p.lastAction && !p.bustedOut) {
        drawBadge(ctx, pos.x, plateY + 43, p.lastAction, actionStyle(p.lastAction));
      }

      if (p.seat === state.dealerSeat) {
        const dx = CX - pos.x, dy = CY - pos.y, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        drawDealerButton(ctx, lerp(pos.x, CX, 0.3) - uy * 66, lerp(pos.y, CY, 0.3) + ux * 66);
      }
    });

    // chips sweeping into the pot
    anim.flying = anim.flying.filter((f) => {
      const t = clamp01((now - f.start) / f.ms);
      if (t >= 1) return false;
      const e = easeInOut(t);
      ctx.save();
      ctx.globalAlpha = 1 - t * 0.3;
      drawChips(ctx, lerp(f.from.x, f.to.x, e), lerp(f.from.y, f.to.y, e) - Math.sin(Math.PI * t) * 14, f.amount, { label: false });
      ctx.restore();
      busy = true;
      return true;
    });

    // showdown: the pot slides over to the winner(s), then a banner
    if (showdown && state.winners.length) {
      const start = firstSeen('award', now, 250);
      const t = clamp01((now - start) / AWARD_MS);
      if (t < 1) busy = true;
      const e = easeInOut(t);
      state.winners.forEach((w) => {
        const p = state.players.find(x => x.id === w.id);
        if (!p || !w.amount) return;
        const pos = posOf(p), spot = betSpot(pos);
        drawChips(ctx, lerp(POT_SPOT.x, spot.x, e), lerp(POT_SPOT.y, spot.y, e) - Math.sin(Math.PI * t) * 18, w.amount, { label: t >= 1 });
      });

      const text = state.winners.map(w => `${w.name} wins ${fmt(w.amount)}${w.handName ? ' — ' + w.handName : ''}`).join('   •   ');
      ctx.font = `700 14px ${SANS}`;
      const tw = Math.min(W - 40, ctx.measureText(text).width + 40);
      const by = CY + 60;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 12 * DPR;
      roundRect(ctx, CX - tw / 2, by - 15, tw, 30, 15);
      const g = ctx.createLinearGradient(0, by - 15, 0, by + 15);
      g.addColorStop(0, 'rgba(40,30,12,0.95)');
      g.addColorStop(1, 'rgba(14,10,4,0.95)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      roundRect(ctx, CX - tw / 2 + 0.5, by - 14.5, tw - 1, 29, 15);
      ctx.strokeStyle = 'rgba(255,210,100,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffe08a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, '✨ ' + text, CX, by + 0.5, tw - 24);
    }

    return busy;
  }

  global.PokerRender = { init, draw, W, H };
})(window);
