/* Poker table renderer - draws a casino-style table on the canvas: padded
   leather rail with stitching, lacquered wood trim, textured felt under an
   overhead lamp, vector-drawn playing cards (real pip layouts and court
   cards), clay chip stacks broken into denominations, and deal / bet / pot
   animations. Pure drawing code - main.js hands it the personalized state. */
(function (global) {
  // The table is laid out in "design units" (BASE_W x H) and scaled to fill
  // the canvas. On screens wider than the design, W grows and the oval
  // stretches sideways (up to MAX_STRETCH) so the table uses the full width.
  // On tall (portrait) screens the table turns upright: a vertical oval
  // that fills a phone instead of a thin wide strip. Same seats and flow.
  const BASE_W = 900, BASE_H = 596, MAX_STRETCH = 1.35;
  const PORTRAIT_W = 620, PORTRAIT_MIN_H = 920, PORTRAIT_MAX_H = 1150;
  let H = BASE_H, CY = H / 2 - 10, portrait = false;
  const BASE_RX = { rail: 428, trim: 381, felt: 368, seat: 370 };
  const RAIL = { rx: BASE_RX.rail, ry: 262 };
  const TRIM = { rx: BASE_RX.trim, ry: 216 };
  const FELT = { rx: BASE_RX.felt, ry: 203 };
  const SEAT = { rx: BASE_RX.seat, ry: 205 };
  let W = BASE_W, CX = W / 2;
  let DECK = { x: CX, y: CY - 130 };
  let POT_SPOT = { x: CX - 36, y: CY - 44 };

  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const SERIF = 'Georgia, "Times New Roman", Times, serif';

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

  // the room being drawn (rooms.js): table, cards and chip scale all follow it
  let T = global.PokerRooms.get('general');
  let chipMult = 1; // chip values are the General set scaled to the room's stakes
  let chipSet = null; // or the room's own printed casino chips & plaques (rooms.js)
  function setRoom(id) {
    const next = global.PokerRooms.get(id);
    if (next === T) return;
    T = next;
    chipMult = T.start / 1000;
    chipSet = T.chips || null;
    bgLayer = null;
    sprites.clear();
  }

  let DPR = 1;          // device pixels per CSS pixel
  let RES = 1;          // device pixels per design unit (DPR * view scale)
  let VIEW = { s: 1, ox: 0, oy: 0, cw: BASE_W, ch: BASE_H };
  // On small screens the table is scaled way down, so cards, avatars and
  // name plates are drawn bigger relative to the table (EL = seat items,
  // ELC = community cards; kept small enough that nothing collides).
  let EL = 1, ELC = 1;
  // user zoom (pinch / double-tap / buttons): scale z and offset (CSS px), eased toward the target
  const zoom = { z: 1, ox: 0, oy: 0, tz: 1, tox: 0, toy: 0 };
  let canvasEl = null;
  let bgLayer = null;
  const sprites = new Map();

  function init(canvas) {
    canvasEl = canvas;
    resize();
    return canvas.getContext('2d');
  }

  // match the canvas to its on-screen size and refit the table to it
  // returns false (and does nothing) when the size hasn't really changed -
  // rebuilding the table is expensive, so never do it needlessly
  function resize() {
    const rect = canvasEl.getBoundingClientRect();
    const cw = Math.max(1, rect.width), ch = Math.max(1, rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (bgLayer && Math.abs(cw - VIEW.cw) < 0.5 && Math.abs(ch - VIEW.ch) < 0.5 && dpr === DPR) return false;
    DPR = dpr;
    portrait = cw / ch < 0.9;
    if (portrait) {
      W = PORTRAIT_W;
      H = Math.max(PORTRAIT_MIN_H, Math.min(PORTRAIT_MAX_H, W * ch / cw));
      CX = W / 2;
      CY = H / 2 + 8;
      const extra = (H - PORTRAIT_MIN_H) / 2;
      // the same oval, turned on its end
      RAIL.rx = 262; RAIL.ry = BASE_RX.rail + extra;
      TRIM.rx = 216; TRIM.ry = BASE_RX.trim + extra;
      FELT.rx = 203; FELT.ry = BASE_RX.felt + extra;
      SEAT.rx = 205; SEAT.ry = BASE_RX.seat + extra;
    } else {
      H = BASE_H;
      CY = H / 2 - 10;
      W = BASE_W * Math.max(1, Math.min(MAX_STRETCH, (cw / ch) / (BASE_W / H)));
      CX = W / 2;
      const extra = (W - BASE_W) / 2;
      RAIL.rx = BASE_RX.rail + extra; RAIL.ry = 262;
      TRIM.rx = BASE_RX.trim + extra; TRIM.ry = 216;
      FELT.rx = BASE_RX.felt + extra; FELT.ry = 203;
      SEAT.rx = BASE_RX.seat + extra; SEAT.ry = 205;
    }
    DECK = { x: CX, y: CY - 130 };
    POT_SPOT = { x: CX - 36, y: CY - 44 };
    const s = Math.min(cw / W, ch / H);
    VIEW = { s, ox: (cw - W * s) / 2, oy: (ch - H * s) / 2, cw, ch };
    EL = Math.max(1, Math.min(portrait ? 1.6 : 1.4, 0.8 / s));
    ELC = Math.min(EL, portrait ? 1.45 : 1.4);
    Object.assign(zoom, { z: 1, ox: 0, oy: 0, tz: 1, tox: 0, toy: 0 });
    RES = DPR * s;
    canvasEl.width = Math.round(cw * DPR);
    canvasEl.height = Math.round(ch * DPR);
    bgLayer = null;
    sprites.clear();
    return true;
  }

  // the whole visible canvas, in design units
  function viewRect() {
    return [-VIEW.ox / VIEW.s, -VIEW.oy / VIEW.s, VIEW.cw / VIEW.s, VIEW.ch / VIEW.s];
  }

  // ---------- small helpers ----------
  function makeLayer(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * RES));
    canvas.height = Math.max(1, Math.ceil(h * RES));
    const ctx = canvas.getContext('2d');
    ctx.scale(RES, RES);
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

  const noiseCache = new Map();
  function noiseCanvas(size, seed, spread) {
    const key = `${size}:${seed}:${spread}`;
    if (noiseCache.has(key)) return noiseCache.get(key);
    const c = document.createElement('canvas');
    noiseCache.set(key, c);
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
      pat.setTransform(new DOMMatrix().scaleSelf(1 / RES, 1 / RES));
    }
    c.fillStyle = pat;
    c.fillRect(...viewRect());
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

  // money on the table: lakh / crore short forms keep big stakes readable
  function fmt(n) { return global.PokerRooms.inr(n, true); }

  // ---------- static background: room, rail, trim, felt, lighting ----------
  function buildBackground() {
    const canvas = document.createElement('canvas');
    canvas.width = canvasEl.width;
    canvas.height = canvasEl.height;
    const c = canvas.getContext('2d');
    c.setTransform(RES, 0, 0, RES, VIEW.ox * DPR, VIEW.oy * DPR);
    const full = viewRect();

    // the room - dark and warm, lit from a lamp over the table
    const room = c.createRadialGradient(CX, CY - 40, 60, CX, CY, 640);
    room.addColorStop(0, T.table.room[0]);
    room.addColorStop(0.55, T.table.room[1]);
    room.addColorStop(1, T.table.room[2]);
    c.fillStyle = room;
    c.fillRect(...full);
    texture(c, noiseCanvas(128, 91, 60), 0.35, 'overlay');

    // table casts a soft shadow on the floor (blurred at quarter resolution -
    // a huge blur at full resolution is by far the slowest part of a rebuild)
    softShadow(c, (sc) => { sc.beginPath(); ellipse(sc, RAIL); }, 46, 20, 0.85);
    c.beginPath(); ellipse(c, RAIL);
    c.fillStyle = '#120a06';
    c.fill();

    // padded leather rail
    c.save();
    c.beginPath(); ellipse(c, RAIL); ellipse(c, TRIM);
    c.clip('evenodd');
    const leather = c.createLinearGradient(0, CY - RAIL.ry, 0, CY + RAIL.ry);
    const RL = T.table.rail;
    leather.addColorStop(0, RL.grad[0]);
    leather.addColorStop(0.5, RL.grad[1]);
    leather.addColorStop(1, RL.grad[2]);
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
      c.strokeStyle = `rgba(0,0,0,${((RL.light ? 0.35 : 0.6) * Math.pow(1 - hump, 2)).toFixed(3)})`;
      c.stroke();
    }
    const sheen = c.createLinearGradient(0, CY - RAIL.ry, 0, CY + RAIL.ry);
    sheen.addColorStop(0, `rgba(${RL.sheen},0.55)`);
    sheen.addColorStop(0.4, `rgba(${RL.sheen},0.10)`);
    sheen.addColorStop(1, `rgba(${RL.sheen},0.03)`);
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
      c.strokeStyle = RL.stitch;
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
    const TR = T.table.trim;
    const wood = c.createLinearGradient(CX - TRIM.rx, 0, CX + TRIM.rx, 0);
    [0, 0.22, 0.5, 0.78, 1].forEach((p, i) => wood.addColorStop(p, TR.stops[i]));
    c.fillStyle = wood;
    c.fillRect(0, 0, W, H);
    const r = rng(42);
    for (let i = 0; i < (TR.kind === 'wood' ? 90 : 0); i++) {
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
    if (TR.inlay) {
      c.beginPath(); ellipse(c, TRIM, (TRIM.rx - FELT.rx) / 2);
      c.strokeStyle = TR.inlay;
      c.lineWidth = 1.6;
      c.stroke();
    }

    // felt
    c.save();
    c.beginPath(); ellipse(c, FELT);
    c.clip();
    const felt = c.createRadialGradient(CX, CY - 40, 20, CX, CY, FELT.rx);
    felt.addColorStop(0, T.table.felt[0]);
    felt.addColorStop(0.55, T.table.felt[1]);
    felt.addColorStop(1, T.table.felt[2]);
    c.fillStyle = felt;
    c.fillRect(0, 0, W, H);
    texture(c, noiseCanvas(256, 3, 80), 0.28, 'overlay');
    texture(c, noiseCanvas(48, 11, 40), 0.10, 'overlay');
    // printed betting line + logo
    c.beginPath(); ellipse(c, { rx: FELT.rx - 58, ry: FELT.ry - 50 });
    c.strokeStyle = T.table.line;
    c.lineWidth = 1.5;
    c.stroke();
    if (T.table.deco || T.table.filigree) drawFeltDecor(c);
    c.fillStyle = T.table.logoColor;
    c.font = `600 ${T.table.deco || T.table.filigree ? 18 : 15}px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(T.table.logo, CX, CY + 76);
    c.font = `italic 11px ${SERIF}`;
    c.fillText('♠  ♥  ♦  ♣', CX, CY + 96);
    // the rail throws a soft shadow onto the felt
    softShadow(c, (sc) => {
      sc.beginPath();
      sc.rect(full[0] - 50, full[1] - 50, full[2] + 100, full[3] + 100);
      ellipse(sc, FELT);
    }, 26, 7, 0.8, 'evenodd');
    c.restore();

    // overhead lamp + vignette
    c.save();
    c.globalCompositeOperation = 'screen';
    const lamp = c.createRadialGradient(CX, CY - 70, 20, CX, CY - 20, 520);
    lamp.addColorStop(0, `rgba(${T.table.lamp},0.17)`);
    lamp.addColorStop(0.5, `rgba(${T.table.lamp},0.04)`);
    lamp.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = lamp;
    c.fillRect(...full);
    c.restore();
    const vig = c.createRadialGradient(CX, CY, 250, CX, CY, 620);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vig;
    c.fillRect(...full);

    return canvas;
  }

  // Draws only the blurred shadow of a shape, computed on a quarter-size
  // canvas and scaled up: visually the same, many times cheaper.
  function softShadow(c, path, blur, offY, alpha, rule) {
    const q = 4;
    const [x0, y0, w, h] = viewRect();
    const L = document.createElement('canvas');
    L.width = Math.max(1, Math.ceil(w * RES / q)); L.height = Math.max(1, Math.ceil(h * RES / q));
    const sc = L.getContext('2d');
    sc.setTransform(RES / q, 0, 0, RES / q, -x0 * RES / q, -y0 * RES / q);
    sc.shadowColor = `rgba(0,0,0,${alpha})`;
    sc.shadowBlur = blur * RES / q;
    sc.shadowOffsetY = offY * RES / q;
    // draw the shape far off-canvas so only its shadow lands in view
    sc.translate(0, -100000);
    sc.shadowOffsetY += 100000 * RES / q;
    path(sc);
    sc.fillStyle = '#000';
    sc.fill(rule || 'nonzero');
    c.drawImage(L, x0, y0, w, h);
  }

  // art-deco fans (Royale) or gold filigree scrolls (Elite) printed on the felt
  function drawFeltDecor(c) {
    c.save();
    c.strokeStyle = T.table.line;
    c.lineWidth = 1;
    if (T.table.deco) {
      for (const side of [-1, 1]) {
        // fans sit either side of the cards: left/right on a wide table, above/below on an upright one
        const x = portrait ? CX : CX + side * (FELT.rx - 120), y = portrait ? CY + side * (FELT.ry - 150) : CY + 30;
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + (i - 3) * 0.28;
          c.beginPath();
          c.moveTo(x, y + 30);
          c.lineTo(x + Math.cos(a) * 60, y + 30 + Math.sin(a) * 60);
          c.stroke();
        }
        c.beginPath(); c.arc(x, y + 30, 60, -Math.PI * 0.5 - 0.9, -Math.PI * 0.5 + 0.9); c.stroke();
        c.beginPath(); c.arc(x, y + 30, 40, -Math.PI * 0.5 - 0.9, -Math.PI * 0.5 + 0.9); c.stroke();
      }
      c.beginPath(); ellipse(c, { rx: FELT.rx - 20, ry: FELT.ry - 16 }); c.stroke();
    } else {
      c.beginPath(); ellipse(c, { rx: FELT.rx - 18, ry: FELT.ry - 14 }); c.stroke();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = CX + Math.cos(a) * (FELT.rx - 32), y = CY + Math.sin(a) * (FELT.ry - 26);
        c.beginPath();
        c.arc(x, y, 6, a, a + Math.PI * 1.4);
        c.arc(x + Math.cos(a + 1.6) * 9, y + Math.sin(a + 1.6) * 9, 3.5, a + Math.PI, a + Math.PI * 2.4);
        c.stroke();
      }
    }
    c.restore();
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

  // Black-and-gold deck: black suits in gold, red suits in rose gold, so
  // flushes stay easy to read without breaking the theme.
  const METALS = {
    gold: ['#fff2bf', '#ecc65e', '#b8892a', '#f5d67f'],
    rose: ['#ffe0cf', '#eea683', '#b86b4a', '#f6bea0'],
    silver: ['#ffffff', '#c9d1da', '#7f8a96', '#e6ebf0'],
    ice: ['#f2fbff', '#8fd3ff', '#2f82bd', '#c6ebff']
  };
  // the room's ink for a suit: a colour or a metal tone
  function toneOf(suit) { return T.cards.ink[isRed(suit) ? 'red' : 'black']; }
  // fill style for a colour-or-metal spec across a box
  function ink(c, spec, x0, y0, x1, y1) { return METALS[spec] ? metal(c, spec, x0, y0, x1, y1) : spec; }

  // brushed-metal gradient across a box
  function metal(c, tone, x0, y0, x1, y1) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    METALS[tone].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
    return g;
  }

  // color: a CSS color, or a metal tone name ('gold' / 'rose')
  function drawSuit(c, suit, x, y, size, flip, color) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);
    c.scale(size, size);
    suitPath(c, suit);
    const tone = color || toneOf(suit);
    c.fillStyle = METALS[tone] ? metal(c, tone, -0.5, -0.5, 0.5, 0.5) : tone;
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
    const F = T.cards;
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, F.face[0]);
    g.addColorStop(0.45, F.face[1]);
    g.addColorStop(1, F.face[2]);
    c.fillStyle = g;
    c.fill();
    // glossy lacquer / foil sheen
    c.save();
    c.clip();
    const sheen = c.createLinearGradient(0, 0, w * 0.7, h * 0.7);
    sheen.addColorStop(0, `rgba(255,255,255,${F.sheen})`);
    sheen.addColorStop(0.5, `rgba(255,255,255,${F.sheen * 0.25})`);
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sheen;
    c.fillRect(0, 0, w, h);
    c.restore();
    c.lineWidth = 1;
    c.strokeStyle = F.edge;
    c.stroke();
    return r;
  }

  // thin gold rule just inside the edge
  function innerBorder(c, w, h, r, tone) {
    const spec = T.cards.inner === 'suit' ? tone : T.cards.inner;
    if (!spec) return;
    const m = Math.max(2, w * 0.045);
    roundRect(c, m, m, w - 2 * m, h - 2 * m, Math.max(1.5, r * 0.6));
    c.strokeStyle = ink(c, spec, 0, 0, w, h);
    c.lineWidth = 0.7;
    c.stroke();
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
    c.fillStyle = ink(c, T.cards.court.crown, x - cw / 2, y - ch / 2, x + cw / 2, y + ch / 2);
    c.fill();
    c.fillStyle = T.cards.court.jewel;
    for (const dx of [-cw / 4, 0, cw / 4]) {
      c.beginPath();
      c.arc(x + dx, y + ch * 0.25, Math.max(0.8, cw * 0.06), 0, Math.PI * 2);
      c.fill();
    }
  }

  function paintFace(c, w, h, card) {
    const r = cardBase(c, w, h);
    const tone = toneOf(card.suit);
    const label = rankLabel(card.rank);
    innerBorder(c, w, h, r, tone);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    if (w < 42) {
      // compact style for small opponent cards: big index + big suit
      c.font = `bold ${Math.round(h * 0.32)}px ${SERIF}`;
      c.fillStyle = ink(c, tone, 0, h * 0.08, 0, h * 0.34);
      fitText(c, label, w * 0.32, h * 0.34, w * 0.46);
      drawSuit(c, card.suit, w * 0.32, h * 0.49, h * 0.17);
      drawSuit(c, card.suit, w * 0.63, h * 0.73, h * 0.34);
      return;
    }

    // corner indices, top-left and (rotated) bottom-right
    for (const flip of [false, true]) {
      c.save();
      if (flip) { c.translate(w, h); c.rotate(Math.PI); }
      c.font = `bold ${Math.round(h * 0.18)}px ${SERIF}`;
      c.fillStyle = ink(c, tone, 0, h * 0.05, 0, h * 0.21);
      fitText(c, label, w * 0.16, h * 0.21, w * 0.18);
      drawSuit(c, card.suit, w * 0.16, h * 0.3, h * 0.095);
      c.restore();
    }

    if (card.rank === 14) {
      drawSuit(c, card.suit, w / 2, h / 2, h * (card.suit === 'S' ? 0.44 : 0.36));
    } else if (card.rank >= 11) {
      const fx = w * 0.25, fy = h * 0.16, fw = w * 0.5, fh = h * 0.68;
      const CT = T.cards.court;
      const trim = ink(c, CT[isRed(card.suit) ? 'trimRed' : 'trimBlack'], fx, fy, fx + fw, fy + fh);
      roundRect(c, fx, fy, fw, fh, 2);
      const fg = c.createLinearGradient(fx, fy, fx + fw, fy + fh);
      fg.addColorStop(0, CT.bg[0]);
      fg.addColorStop(1, CT.bg[1]);
      c.fillStyle = fg;
      c.fill();
      c.lineWidth = 0.9;
      c.strokeStyle = trim;
      c.stroke();
      c.save();
      roundRect(c, fx, fy, fw, fh, 2);
      c.clip();
      for (const flip of [false, true]) {
        c.save();
        if (flip) { c.translate(w, h); c.rotate(Math.PI); }
        crown(c, w / 2, fy + fh * 0.15, fw * 0.5, fh * 0.14, card.rank, '#0b0b0c');
        c.font = `bold ${Math.round(fh * 0.27)}px ${SERIF}`;
        c.fillStyle = ink(c, CT[isRed(card.suit) ? 'trimRed' : 'trimBlack'], 0, fy + fh * 0.24, 0, fy + fh * 0.46);
        c.fillText(label, w / 2, fy + fh * 0.46);
        c.restore();
      }
      c.beginPath();
      c.moveTo(fx, fy + fh * 0.56);
      c.lineTo(fx + fw, fy + fh * 0.44);
      c.strokeStyle = trim;
      c.globalAlpha = 0.6;
      c.lineWidth = 0.6;
      c.stroke();
      c.restore();
      c.globalAlpha = 1;
    } else {
      const cols = [w * 0.35, w * 0.5, w * 0.65];
      const top = h * 0.22, bottom = h * 0.78;
      for (const [col, row] of PIPS[card.rank]) {
        drawSuit(c, card.suit, cols[col], lerp(top, bottom, row), h * 0.13, row > 0.5);
      }
    }
  }

  function paintBack(c, w, h) {
    const B = T.cards.back;
    const r = cardBase(c, w, h);
    const m = Math.max(2.5, w * 0.08);
    if (B.border) {
      roundRect(c, 0.5, 0.5, w - 1, h - 1, r);
      c.fillStyle = B.border;
      c.fill();
    }
    c.save();
    roundRect(c, m, m, w - 2 * m, h - 2 * m, r * 0.6);
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, B.base[0]);
    g.addColorStop(1, B.base[1]);
    c.fillStyle = g;
    c.fill();
    c.clip();
    c.strokeStyle = B.patternColor;
    c.fillStyle = B.patternColor;
    c.lineWidth = 0.6;
    const step = Math.max(4, w * 0.13);
    if (B.pattern === 'pinstripe') {
      c.beginPath();
      for (let x = m; x < w; x += step * 0.45) { c.moveTo(x, 0); c.lineTo(x, h); }
      c.stroke();
    } else if (B.pattern === 'damask') {
      for (let y = m; y < h; y += step * 1.1) {
        for (let x = m + ((y / step) % 2 ? step * 0.55 : 0); x < w; x += step * 1.1) {
          for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2;
            c.beginPath();
            c.ellipse(x + Math.cos(a) * step * 0.18, y + Math.sin(a) * step * 0.18, step * 0.14, step * 0.07, a, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
    } else {
      c.beginPath();
      for (let i = -h; i < w + h; i += step) {
        c.moveTo(i, 0); c.lineTo(i + h, h);
        c.moveTo(i, h); c.lineTo(i + h, 0);
      }
      c.stroke();
      if (B.pattern === 'diamond') {
        for (let y = 0; y < h; y += step) for (let x = (y / step) % 2 ? step / 2 : 0; x < w; x += step) {
          c.beginPath(); c.moveTo(x, y - 1.6); c.lineTo(x + 1.2, y); c.lineTo(x, y + 1.6); c.lineTo(x - 1.2, y); c.closePath(); c.fill();
        }
      }
    }
    c.beginPath();
    c.ellipse(w / 2, h / 2, w * 0.22, h * 0.16, 0, 0, Math.PI * 2);
    c.fillStyle = B.medallion;
    c.fill();
    c.strokeStyle = ink(c, B.emblem, 0, 0, w, h);
    c.lineWidth = 0.9;
    c.stroke();
    drawSuit(c, B.emblemSuit || 'S', w / 2, h / 2, h * 0.15, false, B.emblem);
    c.restore();
    roundRect(c, m, m, w - 2 * m, h - 2 * m, r * 0.6);
    c.strokeStyle = ink(c, B.emblem, 0, 0, w, h);
    c.lineWidth = 0.9;
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
    ctx.shadowBlur = (o.lift ? 12 : 5) * RES;
    ctx.shadowOffsetX = 1 * RES;
    ctx.shadowOffsetY = (o.lift ? 7 : 2.5) * RES;
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

  // ---------- printed casino chips & rectangular plaques (Royale, Elite) ----------
  const CC = { r: 16, ry: 9, t: 3.4 };            // round chip
  const PQ = { w: 46, d: 16, t: 3.6 };           // plaque: width, depth on the felt, thickness

  function paintCasinoChip(c, d, variant) {
    const { r, ry, t } = CC;
    const x = r + 1, y = ry + 1;
    const off = variant * 0.3 + Math.PI / 8;
    // edge band with white inserts
    c.save();
    c.beginPath();
    c.moveTo(x + r, y);
    c.ellipse(x, y + t, r, ry, 0, 0, Math.PI);
    c.lineTo(x - r, y);
    c.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
    c.closePath();
    c.fillStyle = shade(d.base, -35);
    c.fill();
    c.clip();
    c.fillStyle = d.spot;
    for (let k = 0; k < 8; k++) {
      const a = off + k * Math.PI / 4, sn = Math.sin(a);
      if (sn <= 0.1) continue;
      const sw = r * 0.26 * sn;
      c.fillRect(x + r * Math.cos(a) - sw / 2, y + ry * sn, sw, t);
    }
    c.restore();
    // top face
    c.beginPath();
    c.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    const g = c.createRadialGradient(x - r * 0.3, y - ry * 0.5, 1, x, y, r * 1.1);
    g.addColorStop(0, shade(d.base, 40));
    g.addColorStop(1, d.base);
    c.fillStyle = g;
    c.fill();
    // rim inserts (little white blocks round the edge, like real clay chips)
    c.fillStyle = d.spot;
    for (let k = 0; k < 8; k++) {
      const a = off + k * Math.PI / 4;
      c.beginPath();
      c.ellipse(x, y, r, ry, 0, a - 0.13, a + 0.13);
      c.ellipse(x, y, r * 0.8, ry * 0.8, 0, a + 0.13, a - 0.13, true);
      c.closePath();
      c.fill();
    }
    // white centre inlay with the printed value
    c.beginPath();
    c.ellipse(x, y, r * 0.64, ry * 0.64, 0, 0, Math.PI * 2);
    c.fillStyle = '#fbfaf6';
    c.fill();
    c.setLineDash([0.9, 0.9]);
    c.strokeStyle = d.base;
    c.lineWidth = 0.5;
    c.beginPath(); c.ellipse(x, y, r * 0.56, ry * 0.56, 0, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.save();
    c.translate(x, y);
    c.scale(1, ry / r);
    c.fillStyle = d.base === '#18181b' ? '#c8202e' : d.base;
    c.font = `900 ${d.label.length > 4 ? 5.8 : 7}px ${SANS}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    fitText(c, d.label, 0, 0.4, r * 1.05);
    c.restore();
    c.beginPath();
    c.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 0.6;
    c.stroke();
  }

  function paintPlaque(c, d, variant) {
    const { w, d: dep, t } = PQ;
    const x = 1, y = 1, rr = 2;
    // side thickness
    roundRect(c, x, y + t, w, dep, rr);
    c.fillStyle = shade(d.base, -45);
    c.fill();
    // top face
    roundRect(c, x, y, w, dep, rr);
    const g = c.createLinearGradient(x, y, x + w, y + dep);
    g.addColorStop(0, shade(d.base, 35));
    g.addColorStop(1, d.base);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 0.5;
    c.stroke();
    // white notches along the edges
    c.fillStyle = d.spot;
    for (let k = 1; k < 6; k++) {
      const nx = x + (w * k) / 6;
      c.fillRect(nx - 0.8, y, 1.6, 1.1);
      c.fillRect(nx - 0.8, y + dep - 1.1, 1.6, 1.1);
    }
    for (const sx of [x, x + w - 1.3]) c.fillRect(sx, y + dep / 2 - 1, 1.3, 2);
    // white printed panel with the value
    const px = x + w * 0.16, py = y + dep * 0.2, pw = w * 0.68, ph = dep * 0.6;
    roundRect(c, px, py, pw, ph, 0.8);
    c.fillStyle = '#fbfaf6';
    c.fill();
    c.fillStyle = d.base === '#18181b' ? '#c8202e' : shade(d.base, -30);
    c.font = `900 ${Math.min(8.4, 52 / d.label.length)}px ${SANS}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    fitText(c, d.label, px + pw / 2, py + ph / 2 + 0.3, pw - 1.5);
    // tiny crowns in the corners
    c.fillStyle = d.spot;
    for (const [cx, cy] of [[x + w * 0.08, y + dep * 0.28], [x + w * 0.92, y + dep * 0.72]]) {
      c.beginPath();
      c.moveTo(cx - 1.2, cy + 0.8); c.lineTo(cx - 1.2, cy - 0.6); c.lineTo(cx - 0.5, cy); c.lineTo(cx, cy - 1);
      c.lineTo(cx + 0.5, cy); c.lineTo(cx + 1.2, cy - 0.6); c.lineTo(cx + 1.2, cy + 0.8); c.closePath();
      c.fill();
    }
  }

  function casinoSprite(i, variant) {
    const d = chipSet[i];
    if (d.kind === 'plaque') return cached(`plq-${T.id}-${i}`, PQ.w + 2, PQ.d + PQ.t + 2, (c) => paintPlaque(c, d, variant));
    return cached(`cc-${T.id}-${i}-${variant}`, 2 * CC.r + 2, 2 * CC.ry + CC.t + 2, (c) => paintCasinoChip(c, d, variant));
  }

  function breakdown(amount) {
    if (chipSet) {
      const stacks = [];
      let left = Math.max(0, Math.floor(amount));
      for (let i = 0; i < chipSet.length && stacks.length < 4; i++) {
        const n = Math.floor(left / chipSet[i].v);
        if (!n) continue;
        left -= n * chipSet[i].v;
        stacks.push([i, Math.min(chipSet[i].kind === 'plaque' ? 5 : CHIP.maxPerStack, n)]);
      }
      // anything smaller than the smallest chip still shows as one chip
      if (!stacks.length && amount > 0) stacks.push([chipSet.length - 1, 1]);
      return stacks;
    }
    const stacks = [];
    let left = Math.max(0, Math.floor(amount));
    for (let i = 0; i < DENOMS.length && stacks.length < 4; i++) {
      const v = DENOMS[i].v * chipMult;
      const n = Math.floor(left / v);
      if (!n) continue;
      left -= n * v;
      stacks.push([i, Math.min(CHIP.maxPerStack, n)]);
    }
    return stacks;
  }

  // (x, y) is where the stacks rest on the felt
  function drawChips(ctx, x, y, amount, opts) {
    if (!amount) return;
    const o = opts || {};
    const stacks = breakdown(amount);
    if (chipSet) drawCasinoStacks(ctx, x, y, stacks);
    const { r, ry, t } = CHIP;
    const span = r * 2.15;
    const x0 = x - (stacks.length - 1) * span / 2;
    if (!chipSet) stacks.forEach(([di, count], si) => {
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

  // stacks of printed chips / plaques, plaques laid slightly fanned
  function drawCasinoStacks(ctx, x, y, stacks) {
    const widths = stacks.map(([i]) => (chipSet[i].kind === 'plaque' ? PQ.w : 2 * CC.r) + 3);
    let sx = x - widths.reduce((a, b) => a + b, 0) / 2;
    stacks.forEach(([i, count], si) => {
      const d = chipSet[i], w = widths[si];
      const cx = sx + w / 2, sy = y + (si % 2) * 2;
      sx += w;
      ctx.beginPath();
      if (d.kind === 'plaque') { roundRect(ctx, cx - PQ.w / 2 + 1.5, sy - PQ.d / 2 + 2, PQ.w, PQ.d, 2); }
      else ctx.ellipse(cx + 1.5, sy + 2, CC.r + 1.5, CC.ry + 1.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      for (let k = 0; k < count; k++) {
        const jitter = ((k * 37 + si * 11) % 7 - 3) * 0.2;
        if (d.kind === 'plaque') {
          const top = sy - PQ.d / 2 - PQ.t - k * PQ.t;
          ctx.drawImage(casinoSprite(i, 0), cx - PQ.w / 2 - 1 + jitter * 2, top - 1, PQ.w + 2, PQ.d + PQ.t + 2);
        } else {
          const top = sy - CC.t - k * CC.t;
          ctx.drawImage(casinoSprite(i, (k + si) % 3), cx - CC.r - 1 + jitter, top - CC.ry - 1, 2 * CC.r + 2, 2 * CC.ry + CC.t + 2);
        }
      }
    });
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
      ctx.shadowBlur = o.glowSize * RES;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = o.glow;
      ctx.fill();
      ctx.restore();
    }
    // bezel with a drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8 * RES;
    ctx.shadowOffsetY = 3 * RES;
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
    ctx.shadowBlur = 8 * RES;
    ctx.shadowOffsetY = 3 * RES;
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

  // ---------- zoom ----------
  function clampZoom(z, ox, oy) {
    z = Math.max(1, Math.min(3, z));
    const cw = VIEW.cw, ch = VIEW.ch;
    return { z, ox: Math.min(0, Math.max(cw * (1 - z), ox)), oy: Math.min(0, Math.max(ch * (1 - z), oy)) };
  }
  // zoom to z keeping the CSS point (px, py) under the finger / cursor
  function zoomTo(z, px, py, instant) {
    const cur = { z: zoom.tz, ox: zoom.tox, oy: zoom.toy };
    const cx = (px - cur.ox) / cur.z, cy = (py - cur.oy) / cur.z;
    const t = clampZoom(z, px - z * cx, py - z * cy);
    zoom.tz = t.z; zoom.tox = t.ox; zoom.toy = t.oy;
    if (instant) { zoom.z = t.z; zoom.ox = t.ox; zoom.oy = t.oy; }
  }
  // zoom to z and bring the CSS point (px, py) to the middle of the view
  function zoomCentre(z, px, py) {
    const cur = { z: zoom.tz, ox: zoom.tox, oy: zoom.toy };
    const cx = (px - cur.ox) / cur.z, cy = (py - cur.oy) / cur.z;
    const t = clampZoom(z, VIEW.cw / 2 - z * cx, VIEW.ch / 2 - z * cy);
    zoom.tz = t.z; zoom.tox = t.ox; zoom.toy = t.oy;
  }
  function panBy(dx, dy) {
    const t = clampZoom(zoom.tz, zoom.tox + dx, zoom.toy + dy);
    zoom.tox = zoom.ox = t.ox; zoom.toy = zoom.oy = t.oy;
  }
  function stepZoom() {
    const k = 0.25;
    zoom.z += (zoom.tz - zoom.z) * k; zoom.ox += (zoom.tox - zoom.ox) * k; zoom.oy += (zoom.toy - zoom.oy) * k;
    const moving = Math.abs(zoom.tz - zoom.z) > 0.002 || Math.abs(zoom.tox - zoom.ox) > 0.3 || Math.abs(zoom.toy - zoom.oy) > 0.3;
    if (!moving) { zoom.z = zoom.tz; zoom.ox = zoom.tox; zoom.oy = zoom.toy; }
    return moving;
  }

  // ---------- showdown: build the winning hand in the middle of the table ----------
  // The winner's best five cards form a row where the board was: unused board
  // cards drop away, the winner's hole cards fly up from their seat, and the
  // five slide into hand order (e.g. the trips, then the pair) and glow.
  const SD = { delay: 900, drop: 450, flyStart: 350, fly: 700, stagger: 90 };
  const sameCard = (a, b) => a && b && a.rank === b.rank && a.suit === b.suit;

  function handOrder(cards, category) {
    const cnt = {};
    cards.forEach(c => { cnt[c.rank] = (cnt[c.rank] || 0) + 1; });
    const sorted = cards.slice().sort((a, b) => (cnt[b.rank] - cnt[a.rank]) || (b.rank - a.rank) || (a.suit < b.suit ? -1 : 1));
    // a 5-high straight (A-2-3-4-5) shows the ace at the low end
    if ((category === 4 || category === 8) && sorted[0].rank === 14 && sorted.some(c => c.rank === 5) && !sorted.some(c => c.rank === 13)) sorted.push(sorted.shift());
    return sorted;
  }

  function showdownPlan(state) {
    if (anim.sdPlan !== undefined && anim.sdPlanHand === state.handNumber) return anim.sdPlan;
    anim.sdPlanHand = state.handNumber;
    anim.sdPlan = null;
    const w = state.winners.find(x => x.handName);
    const p = w && state.players.find(x => x.id === w.id);
    if (!p || !p.holeCards || !p.holeCards[0] || state.community.length < 5 || !global.PK) return null;
    const best = global.PK.bestHand(p.holeCards.concat(state.community));
    if (!best) return null;
    const order = handOrder(best.cards, best.rank[0]).map(card => {
      const ci = state.community.findIndex(c => sameCard(c, card));
      return ci >= 0 ? { card, src: 'board', index: ci } : { card, src: 'hole', index: p.holeCards.findIndex(c => sameCard(c, card)) };
    });
    anim.sdPlan = {
      playerId: p.id, order,
      usedBoard: new Set(order.filter(o => o.src === 'board').map(o => o.index)),
      usedHole: new Set(order.filter(o => o.src === 'hole').map(o => o.index))
    };
    return anim.sdPlan;
  }

  // where a seat's hole card k sits (mirrors the seat drawing below)
  function holeCardSpot(pos, isMe, k) {
    const r = isMe ? 30 : 26, h = isMe ? 70 : 50, spread = isMe ? 17 : 11;
    return { x: pos.x + (k === 0 ? -1 : 1) * spread, y: pos.y - r - h / 2 + (isMe ? 6 : 8) - 6, w: isMe ? 50 : 36, rot: (k === 0 ? -1 : 1) * 0.11 };
  }

  function drawGlow(ctx, x, y, w, h, strength) {
    ctx.save();
    ctx.shadowColor = `rgba(255,210,90,${0.9 * strength})`;
    ctx.shadowBlur = 16 * RES * strength;
    roundRect(ctx, x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4, 6);
    ctx.fillStyle = `rgba(255,214,110,${0.85 * strength})`;
    ctx.fill();
    ctx.restore();
  }

  // ---------- main draw ----------
  function draw(ctx, state, myId, seatColors, now) {
    if (state && state.room) setRoom(state.room);
    if (!bgLayer) bgLayer = buildBackground();
    const zooming = stepZoom();
    const z = zoom.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.setTransform(z, 0, 0, z, zoom.ox * DPR, zoom.oy * DPR);
    ctx.drawImage(bgLayer, 0, 0);
    ctx.setTransform(RES * z, 0, 0, RES * z, (z * VIEW.ox + zoom.ox) * DPR, (z * VIEW.oy + zoom.oy) * DPR);

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

    let busy = zooming;
    const n = state.players.length;
    const me = state.players.find(p => p.id === myId);
    const mySeat = me ? me.seat : 0;
    const positions = seatPositions(n);
    const posOf = (p) => positions[(p.seat - mySeat + n) % n];
    const showdown = state.stage === 'showdown';
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);

    // community card slots (printed on the felt) + cards
    const cw = Math.round(COMMUNITY.w * ELC), ch = Math.round(COMMUNITY.h * ELC), gap = COMMUNITY.gap;
    const startX = CX - (cw * 5 + gap * 4) / 2 + cw / 2;
    let fresh = 0;
    const plan = showdown ? showdownPlan(state) : null;
    const sdStart = plan ? firstSeen('showdown', now, SD.delay) : 0;
    const sdT = plan ? now - sdStart : -1;
    if (plan && sdT >= 0) {
      busy = true;
      const slotX = (i) => startX + i * (cw + gap);
      // unused board cards drop below the row and fade
      state.community.forEach((card, i) => {
        if (plan.usedBoard.has(i)) return;
        const k = easeOut(clamp01(sdT / SD.drop));
        ctx.save();
        ctx.globalAlpha = 1 - 0.7 * k;
        drawCard(ctx, card, slotX(i), CY + k * (ch * 0.5), cw, ch, { scale: 1 - 0.4 * k });
        ctx.restore();
      });
      // the five winning cards travel into hand order
      const winner = state.players.find(x => x.id === plan.playerId);
      const wpos = winner ? posOf(winner) : { x: CX, y: H };
      const assembled = sdT > SD.flyStart + SD.fly + SD.stagger * 4;
      const pulse = 0.65 + 0.35 * Math.sin(now / 240);
      plan.order.forEach((o, j) => {
        let from, fromScale = 1, fromRot = 0;
        if (o.src === 'board') from = { x: slotX(o.index), y: CY };
        else {
          const hs = holeCardSpot(wpos, winner && winner.id === myId, o.index);
          from = { x: wpos.x + (hs.x - wpos.x) * EL, y: wpos.y + (hs.y - wpos.y) * EL }; fromScale = hs.w * EL / cw; fromRot = hs.rot;
        }
        const to = { x: slotX(j), y: CY };
        const k = easeInOut(clamp01((sdT - SD.flyStart - j * SD.stagger) / SD.fly));
        const x = lerp(from.x, to.x, k);
        const y = lerp(from.y, to.y, k) - Math.sin(Math.PI * k) * (o.src === 'hole' ? 40 : 22);
        const moving = k > 0 && k < 1;
        if (assembled) drawGlow(ctx, to.x, to.y, cw, ch, pulse);
        else if (k >= 1) drawGlow(ctx, to.x, to.y, cw, ch, 0.5);
        drawCard(ctx, o.card, x, y, cw, ch, { scale: lerp(fromScale, 1, k) * (moving ? 1.08 : 1), rot: lerp(fromRot, 0, k), lift: moving });
      });
    }
    for (let i = 0; i < 5 && !(plan && sdT >= 0); i++) {
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
      ctx.save();
      ctx.translate(pos.x, pos.y); ctx.scale(EL, EL); ctx.translate(-pos.x, -pos.y);

      // hole cards, fanned and tucked just behind the avatar
      if (p.holeCards && p.holeCards.length && !p.bustedOut && !p.folded) {
        const w = isMe ? 50 : 36, h = isMe ? 70 : 50;
        const spread = isMe ? 17 : 11;
        const cy = pos.y - r - h / 2 + (isMe ? 6 : 8);
        const faceUp = isMe || showdown;
        p.holeCards.forEach((card, k) => {
          const side = k === 0 ? -1 : 1;
          if (plan && sdT >= SD.flyStart && p.id === plan.playerId && plan.usedHole.has(k)) return; // it's in the winning row now
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
      // countdown ring for the player on the clock
      const tt = state.turnTimer;
      if (state.actingId === p.id && !showdown && tt && tt.left > 0) {
        const f = Math.max(0, Math.min(1, tt.left / tt.total));
        const col = f > 0.5 ? '#3ddc84' : f > 0.2 ? '#f5c542' : '#ef4444';
        ctx.save();
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
        ctx.strokeStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 8 * RES;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
        // seconds badge
        const sec = Math.ceil(tt.left / 1000);
        const bx = pos.x + (r + 9) * 0.72, by = pos.y - (r + 9) * 0.72;
        ctx.beginPath();
        ctx.arc(bx, by, 10, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.fillStyle = f > 0.2 ? '#10130f' : '#fff';
        ctx.font = `800 10px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(sec), bx, by + 0.5);
        busy = true;
      }

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
      ctx.restore(); // end of the seat's EL scale

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
      const start = firstSeen('award', now, plan ? SD.delay + SD.flyStart + SD.fly + SD.stagger * 4 + 200 : 250);
      const t = clamp01((now - start) / AWARD_MS);
      if (t < 1) busy = true;
      const e = easeInOut(t);
      state.winners.forEach((w) => {
        const p = state.players.find(x => x.id === w.id);
        if (!p || !w.amount) return;
        const pos = posOf(p), spot = betSpot(pos);
        drawChips(ctx, lerp(POT_SPOT.x, spot.x, e), lerp(POT_SPOT.y, spot.y, e) - Math.sin(Math.PI * t) * 18, w.amount, { label: t >= 1 });
      });

      const text = state.winners.map(w => `${w.name === 'You' ? 'You win' : w.name + ' wins'} ${fmt(w.amount)}${w.handName ? ' — ' + w.handName : ''}`).join('   •   ');
      ctx.font = `700 14px ${SANS}`;
      const tw = Math.min(W - 40, ctx.measureText(text).width + 40);
      // with the hand being built, the banner waits for it and sits below the dropped cards
      const bannerIn = plan ? clamp01((sdT - (SD.flyStart + SD.fly + SD.stagger * 4)) / 300) : 1;
      const by = plan ? CY + 85 : CY + 60;
      ctx.save();
      ctx.globalAlpha = bannerIn;
      ctx.translate(CX, by);
      ctx.scale(0.9 + 0.1 * easeOut(bannerIn), 0.9 + 0.1 * easeOut(bannerIn));
      ctx.translate(-CX, -by);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 12 * RES;
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
      ctx.restore();
    }

    return busy;
  }

  global.PokerRender = { init, resize, draw, setRoom, zoomTo, zoomCentre, panBy, getZoom: () => zoom.tz, isSmall: () => EL > 1.01 };
})(window);
