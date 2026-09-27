/* Chess renderer: a wooden board seen at an angle (real perspective
   projection), with every piece drawn as a carved character statue -
   soldier (pawn), war horse (knight), camel (bishop), war elephant with a
   tower (rook), queen and king - ivory & gold for white, ebony & bronze
   for black.

   Moves are animated: soldiers march, horses leap, elephants lumber. On a
   capture the attacker closes in and strikes in its own way (spear thrust,
   horse rearing, elephant charge, camel lunge, royal sword slash) and the
   victim is knocked back, topples and vanishes in dust.

   Pure drawing + animation. main.js tells it the position and the moves. */
(function (global) {
  'use strict';
  const E = global.ChessEngine;

  // ---------- materials ----------
  const SIDES = {
    w: { light: '#fffaf0', mid: '#eadfc6', dark: '#a8967200', shade: '#b3a07c', trim: '#d4a73a', trimDark: '#8a6a1c', eye: '#3a2a18', accent: '#b8322d' },
    b: { light: '#8a7e70', mid: '#443c35', dark: '#161311', shade: '#1d1916', trim: '#c07a3c', trimDark: '#6e3e14', eye: '#f0c060', accent: '#8f1f1f' }
  };
  const HEIGHT = { P: 0.74, N: 0.98, B: 1.02, R: 1.04, Q: 1.16, K: 1.3 };

  let DPR = 1, canvas = null, ctx = null;
  let cw = 0, ch = 0;
  let flipped = false;
  let cam = null;
  let boardLayer = null;
  const spriteCache = new Map();

  // ---------- projection ----------
  // Board plane is Y = 0; files run along X (-4..4), ranks along Z (0..8,
  // 0 = the edge nearest the viewer). Camera sits above and behind the near edge.
  function setupCamera() {
    // narrow/portrait screens get a steeper, more top-down view so the
    // board fills the space instead of receding into the distance
    const portrait = clamp01((1.25 - cw / ch) / 0.6);
    const C = { x: 0, y: lerp(10.5, 13, portrait), z: lerp(-6.2, -2.6, portrait) };
    const target = { x: 0, y: 0, z: 3.7 };
    const pitch = Math.atan2(C.y - target.y, target.z - C.z);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const c = { C, cosP, sinP, F: 1, cx: 0, cy: 0 };
    const raw = (X, Y, Z) => {
      const rx = X - C.x, ry = Y - C.y, rz = Z - C.z;
      const yc = ry * cosP + rz * sinP;
      const zc = -ry * sinP + rz * cosP;
      return { x: rx / zc, y: -yc / zc, zc };
    };
    c.raw = raw;
    // fit the board (with frame) and the tallest far pieces into the canvas
    const pts = [];
    for (const X of [-4.7, 4.7]) for (const Z of [-0.7, 8.7]) pts.push(raw(X, 0, Z));
    for (const X of [-4, 4]) pts.push(raw(X, 1.45, 8));
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
    const m = 14;
    c.F = Math.min((cw - 2 * m) / (maxX - minX), (ch - 2 * m) / (maxY - minY));
    c.cx = cw / 2 - c.F * (minX + maxX) / 2;
    c.cy = ch / 2 - c.F * (minY + maxY) / 2;
    return c;
  }
  function project(X, Y, Z) {
    const p = cam.raw(X, Y, Z);
    return { x: cam.cx + cam.F * p.x, y: cam.cy + cam.F * p.y, s: cam.F / p.zc };
  }
  // screen point -> board plane (X, Z)
  function unproject(sx, sy) {
    const dx = (sx - cam.cx) / cam.F, dy = -(sy - cam.cy) / cam.F;
    // camera basis: right=(1,0,0), up=(0,cos,sin), forward=(0,-sin,cos)
    const dir = { x: dx, y: dy * cam.cosP - cam.sinP, z: dy * cam.sinP + cam.cosP };
    const t = -cam.C.y / dir.y;
    return { X: cam.C.x + dir.x * t, Z: cam.C.z + dir.z * t };
  }
  function sqToWorld(sq) {
    const f = E.fileOf(sq), r = E.rankOf(sq);
    return flipped ? { X: 3.5 - f, Z: 7.5 - r } : { X: f - 3.5, Z: r + 0.5 };
  }
  function worldToSq(X, Z) {
    let f = Math.floor(X + 4), r = Math.floor(Z);
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    if (flipped) { f = 7 - f; r = 7 - r; }
    return r * 8 + f;
  }

  // ---------- small helpers ----------
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function quad(c, pts) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); }

  // ---------- static board ----------
  function buildBoard() {
    const L = document.createElement('canvas');
    L.width = Math.round(cw * DPR); L.height = Math.round(ch * DPR);
    const c = L.getContext('2d');
    c.scale(DPR, DPR);
    const r = rng(11);

    // the table it sits on: dark wood with a lamp pool
    const bg = c.createRadialGradient(cw / 2, ch * 0.42, 40, cw / 2, ch * 0.5, Math.max(cw, ch) * 0.8);
    bg.addColorStop(0, '#4a3322');
    bg.addColorStop(0.55, '#24170e');
    bg.addColorStop(1, '#0b0705');
    c.fillStyle = bg;
    c.fillRect(0, 0, cw, ch);
    c.globalAlpha = 0.18;
    for (let i = 0; i < 140; i++) {
      c.strokeStyle = r() < 0.6 ? '#120a05' : '#6b4a30';
      c.lineWidth = 0.5 + r() * 1.5;
      const y = r() * ch;
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(cw * 0.3, y + (r() - 0.5) * 30, cw * 0.7, y + (r() - 0.5) * 30, cw, y + (r() - 0.5) * 20);
      c.stroke();
    }
    c.globalAlpha = 1;

    const P = (X, Z) => project(X, 0, Z);
    // board shadow
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.75)';
    c.shadowBlur = 30 * DPR;
    c.shadowOffsetY = 14 * DPR;
    quad(c, [P(-4.7, -0.7), P(4.7, -0.7), P(4.7, 8.7), P(-4.7, 8.7)]);
    c.fillStyle = '#2a140a';
    c.fill();
    c.restore();
    // near edge thickness of the board (a visible side face)
    const lipA = P(-4.7, -0.7), lipB = P(4.7, -0.7);
    const lipDrop = lipA.s * 0.22;
    c.beginPath();
    c.moveTo(lipA.x, lipA.y); c.lineTo(lipB.x, lipB.y); c.lineTo(lipB.x, lipB.y + lipDrop); c.lineTo(lipA.x, lipA.y + lipDrop);
    c.closePath();
    const lipG = c.createLinearGradient(0, lipA.y, 0, lipA.y + lipDrop);
    lipG.addColorStop(0, '#5a2e14');
    lipG.addColorStop(1, '#1e0e05');
    c.fillStyle = lipG;
    c.fill();

    // mahogany frame
    quad(c, [P(-4.7, -0.7), P(4.7, -0.7), P(4.7, 8.7), P(-4.7, 8.7)]);
    const fr = c.createLinearGradient(0, P(0, 8.7).y, 0, P(0, -0.7).y);
    fr.addColorStop(0, '#4a2412');
    fr.addColorStop(0.5, '#6d3519');
    fr.addColorStop(1, '#40200f');
    c.fillStyle = fr;
    c.fill();
    c.save();
    c.clip();
    c.globalAlpha = 0.25;
    for (let i = 0; i < 120; i++) {
      const z = -0.7 + r() * 9.4;
      c.strokeStyle = r() < 0.7 ? '#1d0b03' : '#a0603a';
      c.lineWidth = 0.4 + r();
      const a = P(-4.7, z), b = P(4.7, z + (r() - 0.5) * 0.2);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    c.restore();
    // gold inlay line
    quad(c, [P(-4.18, -0.18), P(4.18, -0.18), P(4.18, 8.18), P(-4.18, 8.18)]);
    c.strokeStyle = 'rgba(230,190,90,0.85)';
    c.lineWidth = 1.4;
    c.stroke();

    // squares
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const X0 = file - 4, Z0 = rank;
        const light = (file + rank) % 2 === (flipped ? 0 : 1);
        quad(c, [P(X0, Z0), P(X0 + 1, Z0), P(X0 + 1, Z0 + 1), P(X0, Z0 + 1)]);
        const a = P(X0, Z0 + 1), b = P(X0 + 1, Z0);
        const g = c.createLinearGradient(a.x, a.y, b.x, b.y);
        if (light) { g.addColorStop(0, '#f1dcb0'); g.addColorStop(1, '#d9ba84'); }
        else { g.addColorStop(0, '#83502c'); g.addColorStop(1, '#5e361b'); }
        c.fillStyle = g;
        c.fill();
        // grain inside each square, running along the file direction
        c.save();
        c.clip();
        c.globalAlpha = light ? 0.16 : 0.22;
        for (let k = 0; k < 7; k++) {
          const x = X0 + r();
          const p0 = P(x, Z0), p1 = P(x + (r() - 0.5) * 0.08, Z0 + 1);
          c.strokeStyle = light ? '#8a5a2a' : '#2a1206';
          c.lineWidth = 0.5 + r() * 0.8;
          c.beginPath(); c.moveTo(p0.x, p0.y); c.quadraticCurveTo((p0.x + p1.x) / 2 + (r() - 0.5) * 3, (p0.y + p1.y) / 2, p1.x, p1.y); c.stroke();
        }
        c.restore();
      }
    }
    // lacquer sheen from the lamp
    c.save();
    quad(c, [P(-4, 0), P(4, 0), P(4, 8), P(-4, 8)]);
    c.clip();
    c.globalCompositeOperation = 'screen';
    const lp = P(-0.8, 5.2);
    const sheen = c.createRadialGradient(lp.x, lp.y, 5, lp.x, lp.y, lp.s * 5);
    sheen.addColorStop(0, 'rgba(255,240,210,0.22)');
    sheen.addColorStop(1, 'rgba(255,240,210,0)');
    c.fillStyle = sheen;
    c.fillRect(0, 0, cw, ch);
    c.restore();

    // coordinates on the frame
    c.fillStyle = 'rgba(240,205,120,0.9)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      const fileLetter = 'abcdefgh'[flipped ? 7 - i : i];
      const rankNum = String(flipped ? 8 - i : i + 1);
      const pf = P(i - 3.5, -0.42);
      c.font = `600 ${Math.round(pf.s * 0.26)}px Georgia, serif`;
      c.fillText(fileLetter, pf.x, pf.y);
      const pr = P(-4.42, i + 0.5);
      c.font = `600 ${Math.round(pr.s * 0.26)}px Georgia, serif`;
      c.fillText(rankNum, pr.x, pr.y);
    }

    // vignette
    const vig = c.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = vig;
    c.fillRect(0, 0, cw, ch);
    return L;
  }

  // ---------- statue materials ----------
  function stone(c, S, x0, y0, x1, y1) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, S.light);
    g.addColorStop(0.45, S.mid);
    g.addColorStop(1, S.shade);
    return g;
  }
  function metal(c, S, x0, y0, x1, y1) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#fff3c0');
    g.addColorStop(0.35, S.trim);
    g.addColorStop(1, S.trimDark);
    return g;
  }
  function fillPath(c, style, lw, stroke) {
    c.fillStyle = style;
    c.fill();
    if (lw) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
  }
  function ellipse(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); }
  function limb(c, x0, y0, x1, y1, w0, w1, style, S) {
    const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
    c.beginPath();
    c.moveTo(x0 + nx * w0, y0 + ny * w0);
    c.lineTo(x1 + nx * w1, y1 + ny * w1);
    c.lineTo(x1 - nx * w1, y1 - ny * w1);
    c.lineTo(x0 - nx * w0, y0 - ny * w0);
    c.closePath();
    fillPath(c, style, 0.006, 'rgba(0,0,0,0.35)');
  }
  const OUT = (S) => (S === SIDES.w ? 'rgba(90,70,40,0.55)' : 'rgba(0,0,0,0.6)');

  // ---------- the characters (1 unit = one square; y up is negative; facing +x) ----------
  function drawSoldier(c, S, pose) {
    const walk = Math.sin(pose.walk || 0) * (pose.walkAmp || 0);
    const atk = pose.attack || 0;
    const body = stone(c, S, -0.2, -0.7, 0.2, 0);
    // legs
    limb(c, -0.04, -0.27, -0.05 - walk * 0.1, 0, 0.035, 0.03, body, S);
    limb(c, 0.04, -0.27, 0.05 + walk * 0.1, 0, 0.035, 0.03, body, S);
    // sandals
    c.fillStyle = S.trimDark;
    ellipse(c, -0.05 - walk * 0.1 + 0.02, -0.008, 0.045, 0.014); c.fill();
    ellipse(c, 0.05 + walk * 0.1 + 0.02, -0.008, 0.045, 0.014); c.fill();
    // tunic with a flared skirt
    c.beginPath();
    c.moveTo(-0.09, -0.52); c.lineTo(0.09, -0.52); c.lineTo(0.13, -0.26); c.quadraticCurveTo(0, -0.22, -0.13, -0.26); c.closePath();
    fillPath(c, body, 0.008, OUT(S));
    // armour straps + belt
    c.fillStyle = metal(c, S, -0.1, -0.4, 0.1, -0.35);
    c.fillRect(-0.1, -0.37, 0.2, 0.03);
    c.strokeStyle = S.trimDark; c.lineWidth = 0.008;
    for (const x of [-0.07, -0.02, 0.03, 0.08]) { c.beginPath(); c.moveTo(x, -0.34); c.lineTo(x * 1.25, -0.26); c.stroke(); }
    // spear: upright at rest, lowered and thrust forward when attacking
    const ang = lerp(-1.45, -0.05, easeOut(atk)), reach = atk * 0.26;
    const gx = 0.1 + reach * 0.6, gy = -0.36;
    c.save();
    c.translate(gx, gy);
    c.rotate(ang);
    c.fillStyle = '#6b4a2a';
    c.fillRect(-0.22, -0.012, 0.66, 0.024);
    c.beginPath(); c.moveTo(0.44, -0.035); c.lineTo(0.56, 0); c.lineTo(0.44, 0.035); c.closePath();
    fillPath(c, metal(c, S, 0.44, -0.04, 0.56, 0.04), 0.006, S.trimDark);
    c.restore();
    // spear arm
    limb(c, 0.02, -0.49, gx, gy, 0.028, 0.024, body, S);
    // round shield on the near side
    ellipse(c, -0.02, -0.39, 0.11, 0.13);
    fillPath(c, metal(c, S, -0.13, -0.52, 0.09, -0.26), 0.01, S.trimDark);
    ellipse(c, -0.02, -0.39, 0.07, 0.085);
    fillPath(c, stone(c, S, -0.09, -0.47, 0.05, -0.3), 0.006, S.trimDark);
    ellipse(c, -0.02, -0.39, 0.022, 0.026);
    c.fillStyle = S.trim; c.fill();
    // head + crested helmet
    ellipse(c, 0.02, -0.6, 0.065, 0.07);
    fillPath(c, body, 0.007, OUT(S));
    c.beginPath();
    c.moveTo(-0.06, -0.6); c.quadraticCurveTo(-0.05, -0.7, 0.02, -0.705); c.quadraticCurveTo(0.09, -0.7, 0.09, -0.61); c.closePath();
    fillPath(c, metal(c, S, -0.06, -0.71, 0.09, -0.6), 0.006, S.trimDark);
    c.beginPath();
    c.moveTo(-0.06, -0.69); c.quadraticCurveTo(0.0, -0.8, 0.07, -0.7); c.lineTo(0.04, -0.69); c.closePath();
    c.fillStyle = S.accent; c.fill();
    ellipse(c, 0.06, -0.6, 0.008, 0.01); c.fillStyle = S.eye; c.fill();
  }

  function drawHorse(c, S, pose) {
    const ph = pose.walk || 0, amp = pose.walkAmp || 0, rear = pose.rear || 0;
    const body = stone(c, S, -0.35, -0.95, 0.35, 0);
    c.save();
    // rearing pivots on the hind hooves
    c.translate(-0.2, 0);
    c.rotate(-rear * 0.55);
    c.translate(0.2, 0);
    const legs = [[-0.2, 0], [-0.13, Math.PI], [0.14, Math.PI * 0.5], [0.21, Math.PI * 1.5]];
    legs.forEach(([x, off], i) => {
      const swing = Math.sin(ph + off) * amp * 0.12;
      const front = i >= 2;
      const lift = front ? rear * 0.18 : 0;
      const kx = x + swing * 0.5 + (front ? rear * 0.08 : 0), ky = -0.2 - lift;
      const hx = x + swing + (front ? rear * 0.14 : 0), hy = -0.01 - lift * 1.4;
      limb(c, x, -0.4, kx, ky, 0.04, 0.028, body, S);
      limb(c, kx, ky, hx, hy, 0.028, 0.022, body, S);
      c.fillStyle = S.trimDark;
      ellipse(c, hx + 0.01, hy + 0.005, 0.03, 0.016); c.fill();
    });
    // tail
    const swish = Math.sin((pose.t || 0) * 3) * 0.04;
    c.beginPath();
    c.moveTo(-0.27, -0.5);
    c.quadraticCurveTo(-0.42, -0.45 + swish, -0.36 + swish, -0.18);
    c.quadraticCurveTo(-0.33, -0.3, -0.26, -0.44);
    c.closePath();
    c.fillStyle = S === SIDES.w ? '#cdbb96' : '#0d0b0a'; c.fill();
    // barrel of the body
    ellipse(c, 0, -0.47, 0.29, 0.14);
    fillPath(c, body, 0.008, OUT(S));
    // neck and head
    c.beginPath();
    c.moveTo(0.16, -0.56);
    c.quadraticCurveTo(0.2, -0.78, 0.3, -0.86);
    c.lineTo(0.38, -0.82);
    c.quadraticCurveTo(0.34, -0.66, 0.28, -0.44);
    c.closePath();
    fillPath(c, body, 0.008, OUT(S));
    c.beginPath();
    c.moveTo(0.28, -0.9);
    c.quadraticCurveTo(0.33, -0.93, 0.39, -0.87);
    c.lineTo(0.5, -0.72);
    c.quadraticCurveTo(0.52, -0.66, 0.46, -0.66);
    c.lineTo(0.36, -0.71);
    c.quadraticCurveTo(0.29, -0.76, 0.28, -0.9);
    c.closePath();
    fillPath(c, body, 0.008, OUT(S));
    // ear, eye, nostril, mane
    c.beginPath(); c.moveTo(0.31, -0.9); c.lineTo(0.3, -0.98); c.lineTo(0.35, -0.91); c.closePath();
    fillPath(c, body, 0.006, OUT(S));
    ellipse(c, 0.37, -0.83, 0.013, 0.01); c.fillStyle = S.eye; c.fill();
    ellipse(c, 0.485, -0.685, 0.01, 0.007); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
    c.strokeStyle = S === SIDES.w ? '#bca77c' : '#0b0908';
    c.lineWidth = 0.022; c.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const x = lerp(0.29, 0.17, t), y = lerp(-0.9, -0.58, t);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 0.05, y + 0.03); c.stroke();
    }
    c.lineCap = 'butt';
    // bridle + saddle cloth with fringe
    c.strokeStyle = S.trim; c.lineWidth = 0.012;
    c.beginPath(); c.moveTo(0.33, -0.88); c.lineTo(0.44, -0.7); c.moveTo(0.36, -0.76); c.lineTo(0.47, -0.7); c.stroke();
    c.beginPath();
    c.moveTo(-0.12, -0.6); c.quadraticCurveTo(0, -0.64, 0.12, -0.6); c.lineTo(0.14, -0.4); c.quadraticCurveTo(0, -0.37, -0.14, -0.4); c.closePath();
    fillPath(c, S.accent, 0.008, S.trimDark);
    c.strokeStyle = S.trim; c.lineWidth = 0.01;
    c.beginPath(); c.moveTo(-0.14, -0.42); c.quadraticCurveTo(0, -0.39, 0.14, -0.42); c.stroke();
    ellipse(c, 0, -0.61, 0.07, 0.025);
    fillPath(c, metal(c, S, -0.07, -0.64, 0.07, -0.58), 0.006, S.trimDark);
    c.restore();
  }

  function drawElephant(c, S, pose) {
    const ph = pose.walk || 0, amp = pose.walkAmp || 0, charge = pose.attack || 0;
    const body = stone(c, S, -0.4, -1.0, 0.4, 0);
    const legs = [[-0.22, 0], [-0.12, Math.PI], [0.12, Math.PI * 0.5], [0.22, Math.PI * 1.5]];
    legs.forEach(([x, off]) => {
      const swing = Math.sin(ph + off) * amp * 0.06;
      limb(c, x, -0.36, x + swing, 0, 0.06, 0.055, body, S);
      c.fillStyle = S.trimDark;
      ellipse(c, x + swing, -0.01, 0.06, 0.018); c.fill();
    });
    // tail
    c.strokeStyle = S.shade; c.lineWidth = 0.02;
    c.beginPath(); c.moveTo(-0.33, -0.44); c.quadraticCurveTo(-0.4, -0.35, -0.37, -0.24); c.stroke();
    // body
    ellipse(c, -0.02, -0.46, 0.34, 0.2);
    fillPath(c, body, 0.009, OUT(S));
    // decorated caparison cloth
    c.beginPath();
    c.moveTo(-0.24, -0.6); c.quadraticCurveTo(0, -0.66, 0.2, -0.6); c.lineTo(0.18, -0.34); c.quadraticCurveTo(0, -0.28, -0.24, -0.34); c.closePath();
    fillPath(c, S.accent, 0.009, S.trimDark);
    c.strokeStyle = S.trim; c.lineWidth = 0.014;
    c.beginPath(); c.moveTo(-0.23, -0.37); c.quadraticCurveTo(0, -0.31, 0.18, -0.37); c.stroke();
    for (let i = 0; i < 5; i++) { ellipse(c, -0.17 + i * 0.08, -0.47, 0.018, 0.018); c.fillStyle = S.trim; c.fill(); }
    // head, big ear, trunk (raised during a charge), tusk
    ellipse(c, 0.27, -0.55, 0.13, 0.14);
    fillPath(c, body, 0.008, OUT(S));
    const tr = charge;
    c.beginPath();
    c.moveTo(0.33, -0.5);
    c.quadraticCurveTo(lerp(0.45, 0.5, tr), lerp(-0.4, -0.75, tr), lerp(0.44, 0.62, tr), lerp(-0.1, -0.86, tr));
    c.lineTo(lerp(0.4, 0.58, tr), lerp(-0.1, -0.88, tr));
    c.quadraticCurveTo(lerp(0.38, 0.44, tr), lerp(-0.38, -0.66, tr), 0.3, -0.44);
    c.closePath();
    fillPath(c, body, 0.008, OUT(S));
    c.beginPath();
    c.moveTo(0.3, -0.47); c.quadraticCurveTo(0.42, -0.42, 0.44, -0.5);
    c.lineWidth = 0.028; c.strokeStyle = '#fbf6e6'; c.lineCap = 'round'; c.stroke(); c.lineCap = 'butt';
    ellipse(c, 0.18, -0.56, 0.1, 0.14, 0.2);
    fillPath(c, stone(c, S, 0.08, -0.7, 0.28, -0.42), 0.008, OUT(S));
    ellipse(c, 0.32, -0.6, 0.013, 0.011); c.fillStyle = S.eye; c.fill();
    // the tower (howdah) on its back - the rook's castle
    const tx = -0.06, base = -0.64, top = -1.0;
    c.beginPath();
    c.moveTo(tx - 0.15, base); c.lineTo(tx + 0.15, base); c.lineTo(tx + 0.13, top + 0.06); c.lineTo(tx - 0.13, top + 0.06); c.closePath();
    fillPath(c, stone(c, S, tx - 0.15, top, tx + 0.15, base), 0.009, OUT(S));
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.006;
    for (let y = base - 0.06; y > top + 0.08; y -= 0.06) { c.beginPath(); c.moveTo(tx - 0.14, y); c.lineTo(tx + 0.14, y); c.stroke(); }
    for (let i = 0; i < 4; i++) {
      const bx = tx - 0.13 + i * 0.075;
      c.fillStyle = stone(c, S, bx, top, bx + 0.05, top + 0.06);
      c.fillRect(bx, top, 0.05, 0.07);
    }
    c.fillStyle = S.trim;
    c.fillRect(tx - 0.15, base - 0.02, 0.3, 0.025);
    c.fillStyle = '#1a120a';
    c.beginPath(); c.moveTo(tx - 0.03, base - 0.03); c.lineTo(tx - 0.03, base - 0.12); c.quadraticCurveTo(tx, base - 0.16, tx + 0.03, base - 0.12); c.lineTo(tx + 0.03, base - 0.03); c.closePath(); c.fill();
  }

  function drawCamel(c, S, pose) {
    const ph = pose.walk || 0, amp = pose.walkAmp || 0, lunge = pose.attack || 0;
    const body = stone(c, S, -0.35, -1.0, 0.35, 0);
    const legs = [[-0.17, 0], [-0.1, Math.PI], [0.12, Math.PI * 0.5], [0.18, Math.PI * 1.5]];
    legs.forEach(([x, off]) => {
      const swing = Math.sin(ph + off) * amp * 0.1;
      const kx = x + swing * 0.5, ky = -0.27;
      limb(c, x, -0.5, kx, ky, 0.035, 0.026, body, S);
      ellipse(c, kx, ky, 0.03, 0.03); fillPath(c, body, 0, 0);
      limb(c, kx, ky, x + swing, -0.01, 0.024, 0.02, body, S);
      c.fillStyle = S.trimDark;
      ellipse(c, x + swing + 0.01, -0.006, 0.035, 0.014); c.fill();
    });
    c.strokeStyle = S.shade; c.lineWidth = 0.018;
    c.beginPath(); c.moveTo(-0.24, -0.58); c.quadraticCurveTo(-0.3, -0.5, -0.28, -0.4); c.stroke();
    // body + hump
    ellipse(c, 0, -0.57, 0.25, 0.11);
    fillPath(c, body, 0.008, OUT(S));
    c.beginPath();
    c.moveTo(-0.16, -0.62); c.quadraticCurveTo(-0.06, -0.86, 0.08, -0.64); c.closePath();
    fillPath(c, body, 0.008, OUT(S));
    // saddle blanket with tassels
    c.beginPath();
    c.moveTo(-0.15, -0.66); c.quadraticCurveTo(-0.05, -0.82, 0.08, -0.66); c.lineTo(0.1, -0.5); c.lineTo(-0.17, -0.5); c.closePath();
    fillPath(c, S.accent, 0.008, S.trimDark);
    c.fillStyle = S.trim;
    for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-0.15 + i * 0.06, -0.5); c.lineTo(-0.14 + i * 0.06, -0.45); c.lineTo(-0.13 + i * 0.06, -0.5); c.fill(); }
    // long curved neck + head, which lunges forward to bite
    const hx = 0.43 + lunge * 0.14, hy = -0.86 + lunge * 0.16;
    c.beginPath();
    c.moveTo(0.18, -0.62);
    c.quadraticCurveTo(0.34, -0.62, 0.36 + lunge * 0.08, -0.74 + lunge * 0.1);
    c.lineTo(hx - 0.02, hy + 0.03);
    c.lineTo(hx - 0.07, hy + 0.01);
    c.quadraticCurveTo(0.27 + lunge * 0.06, -0.72 + lunge * 0.08, 0.16, -0.52);
    c.closePath();
    fillPath(c, body, 0.008, OUT(S));
    c.beginPath();
    c.moveTo(hx - 0.08, hy - 0.02); c.quadraticCurveTo(hx - 0.02, hy - 0.07, hx + 0.08, hy - 0.01); c.quadraticCurveTo(hx + 0.1, hy + 0.04, hx + 0.03, hy + 0.04); c.lineTo(hx - 0.07, hy + 0.03); c.closePath();
    fillPath(c, body, 0.007, OUT(S));
    c.beginPath(); c.moveTo(hx - 0.07, hy - 0.03); c.lineTo(hx - 0.09, hy - 0.08); c.lineTo(hx - 0.04, hy - 0.04); c.closePath();
    fillPath(c, body, 0.005, OUT(S));
    ellipse(c, hx - 0.01, hy - 0.02, 0.011, 0.009); c.fillStyle = S.eye; c.fill();
    c.strokeStyle = S.trim; c.lineWidth = 0.01;
    c.beginPath(); c.moveTo(hx - 0.05, hy - 0.03); c.lineTo(hx + 0.07, hy + 0.02); c.stroke();
  }

  function drawRoyal(c, S, pose, king) {
    const atk = pose.attack || 0, walk = Math.sin(pose.walk || 0) * (pose.walkAmp || 0);
    const H = king ? 1.0 : 0.92;
    const body = stone(c, S, -0.25, -1.2, 0.25, 0);
    // cape behind
    c.beginPath();
    c.moveTo(-0.08, -H * 0.8); c.quadraticCurveTo(-0.26 - walk * 0.03, -H * 0.4, -0.22, 0); c.lineTo(0.02, 0); c.closePath();
    fillPath(c, S.accent, 0.008, S.trimDark);
    // robe / gown
    c.beginPath();
    c.moveTo(-0.08, -H * 0.78); c.lineTo(0.08, -H * 0.78);
    c.quadraticCurveTo(0.12, -H * 0.4, 0.2 + walk * 0.02, 0);
    c.lineTo(-0.2 + walk * 0.02, 0);
    c.quadraticCurveTo(-0.12, -H * 0.4, -0.08, -H * 0.78);
    c.closePath();
    fillPath(c, body, 0.009, OUT(S));
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 0.008;
    for (const x of [-0.1, -0.03, 0.04, 0.11]) { c.beginPath(); c.moveTo(x * 0.5, -H * 0.55); c.quadraticCurveTo(x, -H * 0.25, x * 1.4, 0); c.stroke(); }
    // hem + belt
    c.fillStyle = metal(c, S, -0.2, -0.04, 0.2, 0);
    c.fillRect(-0.2, -0.035, 0.4, 0.03);
    c.fillRect(-0.09, -H * 0.56, 0.18, 0.03);
    // sword arm: raised then slashes down in front
    const swing = lerp(-2.3, 0.35, easeInOut(atk));
    const sx = 0.06, sy = -H * 0.72;
    const hx = sx + Math.cos(swing + 0.9) * 0.16, hy = sy + Math.sin(swing + 0.9) * 0.16;
    c.save();
    c.translate(hx, hy);
    c.rotate(swing);
    const bl = king ? 0.5 : 0.42;
    c.beginPath(); c.moveTo(0.04, -0.018); c.lineTo(bl, -0.01); c.lineTo(bl + 0.05, 0); c.lineTo(bl, 0.01); c.lineTo(0.04, 0.018); c.closePath();
    fillPath(c, (() => { const g = c.createLinearGradient(0, -0.02, 0, 0.02); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#9aa3ad'); return g; })(), 0.005, '#4a4f56');
    c.fillStyle = metal(c, S, -0.02, -0.05, 0.04, 0.05);
    c.fillRect(0.02, -0.05, 0.022, 0.1);
    c.fillRect(-0.05, -0.012, 0.07, 0.024);
    c.restore();
    limb(c, sx, sy, hx, hy, 0.032, 0.026, body, S);
    // other arm resting
    limb(c, -0.06, -H * 0.72, -0.1, -H * 0.5, 0.03, 0.025, body, S);
    // head
    const headY = -H * 0.88;
    ellipse(c, 0, headY, 0.075, 0.085);
    fillPath(c, body, 0.008, OUT(S));
    if (king) {
      // beard
      c.beginPath(); c.moveTo(-0.05, headY + 0.03); c.quadraticCurveTo(0.02, headY + 0.16, 0.07, headY + 0.03); c.closePath();
      fillPath(c, stone(c, S, -0.05, headY, 0.07, headY + 0.15), 0.006, OUT(S));
    } else {
      // long hair behind
      c.beginPath(); c.moveTo(-0.07, headY - 0.03); c.quadraticCurveTo(-0.13, headY + 0.1, -0.08, headY + 0.2); c.lineTo(-0.03, headY + 0.05); c.closePath();
      fillPath(c, S.shade, 0.006, OUT(S));
    }
    ellipse(c, 0.045, headY - 0.005, 0.009, 0.011); c.fillStyle = S.eye; c.fill();
    // crown
    const cy = headY - 0.07, cwid = king ? 0.09 : 0.075, chgt = king ? 0.13 : 0.09;
    c.beginPath();
    c.moveTo(-cwid, cy);
    const spikes = king ? 5 : 5;
    for (let i = 0; i <= spikes * 2; i++) {
      const x = -cwid + (2 * cwid * i) / (spikes * 2);
      c.lineTo(x, i % 2 ? cy - chgt * 0.55 : cy - chgt);
    }
    c.lineTo(cwid, cy);
    c.closePath();
    fillPath(c, metal(c, S, -cwid, cy - chgt, cwid, cy), 0.006, S.trimDark);
    ellipse(c, 0, cy - chgt * 0.3, 0.018, 0.018); c.fillStyle = S.accent; c.fill();
    if (king) {
      c.fillStyle = metal(c, S, -0.02, cy - chgt - 0.08, 0.02, cy - chgt);
      c.fillRect(-0.01, cy - chgt - 0.08, 0.02, 0.08);
      c.fillRect(-0.035, cy - chgt - 0.058, 0.07, 0.018);
    }
  }

  const DRAW = {
    P: drawSoldier, N: drawHorse, B: drawCamel, R: drawElephant,
    Q: (c, S, p) => drawRoyal(c, S, p, false), K: (c, S, p) => drawRoyal(c, S, p, true)
  };

  // round statue plinth, same for every piece
  function drawPlinth(c, S, rx, ry) {
    const h = 0.05;
    c.beginPath();
    c.ellipse(0, 0, rx, ry, 0, 0, Math.PI);
    c.lineTo(-rx, -h);
    c.ellipse(0, -h, rx, ry, 0, Math.PI, 0, true);
    c.closePath();
    fillPath(c, metal(c, S, -rx, -h, rx, ry), 0.006, S.trimDark);
    ellipse(c, 0, -h, rx, ry);
    const g = c.createRadialGradient(-rx * 0.3, -h - ry * 0.4, 0.01, 0, -h, rx);
    g.addColorStop(0, S.light);
    g.addColorStop(1, S.shade);
    fillPath(c, g, 0.006, S.trimDark);
  }

  // one piece in local units, standing at the origin; facing = +1 right / -1 left
  function drawPieceLocal(c, type, side, pose, facing, flat) {
    const S = SIDES[side];
    drawPlinth(c, S, 0.36, 0.36 * flat); // flat = how squashed the ground is at this depth
    c.save();
    c.translate(0, -0.05);
    c.scale(facing, 1);
    DRAW[type](c, S, pose);
    c.restore();
  }

  // cached idle sprite for a piece at a given on-screen scale
  function sprite(type, side, facing, s, flat) {
    const qs = Math.round(s / 2) * 2, qf = Math.round(flat * 50) / 50;
    const key = `${type}${side}${facing}${qs}${qf}`;
    let sp = spriteCache.get(key);
    if (!sp) {
      const w = 1.3 * qs, h = 1.65 * qs;
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(w * DPR); cv.height = Math.ceil(h * DPR);
      const c = cv.getContext('2d');
      c.scale(DPR * qs, DPR * qs);
      c.translate(0.65, 1.5);
      drawPieceLocal(c, type, side, {}, facing, qf);
      sp = { cv, w, h, ox: 0.65 * qs, oy: 1.5 * qs };
      spriteCache.set(key, sp);
    }
    return sp;
  }

  // small icon of a piece (captured trays, promotion picker)
  function icon(type, side, px) {
    const cv = document.createElement('canvas');
    const d = Math.min(2, global.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(px * d);
    cv.style.width = cv.style.height = px + 'px';
    const c = cv.getContext('2d');
    const s = px / 1.4;
    c.scale(d * s, d * s);
    c.translate(0.7, 1.3);
    drawPieceLocal(c, type, side, {}, side === 'w' ? 1 : -1, 0.35);
    return cv;
  }

  // ---------- visual pieces + animation ----------
  let vpieces = [];   // {id, type, side, X, Z, y, facing, pose, alpha, fall, flash, knock}
  let nextId = 1;
  let timeline = null; // {start, tracks, events, end, done}
  let effects = [];    // {kind, X, Y, Z, t0, dur, ...}
  let shakeUntil = 0, shakeAmp = 0;
  let highlights = { last: null, selected: -1, targets: [], check: -1 };

  function defaultFacing(side) { return side === 'w' ? 1 : -1; }

  function syncPieces(board) {
    vpieces = [];
    board.forEach((p, sq) => {
      if (!p) return;
      const side = E.colorOf(p), w = sqToWorld(sq);
      vpieces.push({ id: nextId++, sq, type: p.toUpperCase(), side, X: w.X, Z: w.Z, y: 0, facing: defaultFacing(side), pose: {}, alpha: 1 });
    });
  }

  function pieceAt(sq) { return vpieces.find(v => v.sq === sq && !v.dead); }

  // turns towards the direction of travel on screen
  function faceTowards(v, X) { if (Math.abs(X - v.X) > 0.05) v.facing = X > v.X ? 1 : -1; }

  const WALK = { P: { amp: 1, bob: 0.03, speed: 11 }, N: { amp: 1, bob: 0.05, speed: 13 }, B: { amp: 1, bob: 0.03, speed: 9 },
    R: { amp: 1, bob: 0.02, speed: 7 }, Q: { amp: 0.6, bob: 0.015, speed: 9 }, K: { amp: 0.6, bob: 0.015, speed: 8 } };

  // Builds the tracks for one move. Tracks: {t0, t1, fn(k)}; events: {t, fn}.
  function buildMoveTimeline(move, boardAfter, sfx) {
    const tracks = [], events = [];
    const mover = pieceAt(move.from);
    if (!mover) return null;
    const from = sqToWorld(move.from), to = sqToWorld(move.to);
    let victimSq = move.captured ? move.to : -1;
    if (move.flag === E.FLAG.EP) victimSq = move.to + (E.colorOf(move.piece) === 'w' ? -8 : 8);
    const victim = victimSq >= 0 ? pieceAt(victimSq) : null;
    const knight = mover.type === 'N';
    const dist = Math.hypot(to.X - from.X, to.Z - from.Z);
    const walk = (v, a, b, t0, dur, hop) => {
      tracks.push({ t0, t1: t0 + dur, fn: (k) => {
        const e = easeInOut(k);
        v.X = lerp(a.X, b.X, e); v.Z = lerp(a.Z, b.Z, e);
        const W = WALK[v.type];
        v.pose.walk = k * dur / 1000 * W.speed; v.pose.walkAmp = k < 1 ? W.amp : 0;
        v.y = hop ? Math.sin(Math.PI * k) * (0.5 + dist * 0.12) : Math.abs(Math.sin(v.pose.walk)) * W.bob * (k < 1 ? 1 : 0);
        if (hop) v.pose.rear = Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.35;
      } });
      events.push({ t: t0, fn: () => { faceTowards(v, b.X); sfx(hop ? 'leap' : v.type === 'R' ? 'stomp' : 'step'); } });
    };

    let t = 0;
    if (victim) {
      // close in, strike, knock the victim down, then take the square
      const vw = { X: victim.X, Z: victim.Z };
      const dx = vw.X - from.X, dz = vw.Z - from.Z, dl = Math.hypot(dx, dz) || 1;
      const stand = { X: vw.X - (dx / dl) * 0.62, Z: vw.Z - (dz / dl) * 0.62 };
      const approach = 250 + Math.hypot(stand.X - from.X, stand.Z - from.Z) * 170;
      walk(mover, from, stand, t, approach, knight);
      t += approach;
      events.push({ t, fn: () => { faceTowards(mover, vw.X); if (Math.abs(vw.X - mover.X) < 0.05) mover.facing = mover.facing || 1; victim.facing = -mover.facing; } });
      const strike = { P: 420, N: 620, B: 460, R: 640, Q: 520, K: 560 }[mover.type];
      const hitAt = t + strike * 0.6;
      tracks.push({ t0: t, t1: t + strike, fn: (k) => {
        const up = k < 0.6 ? easeOut(k / 0.6) : 1 - easeInOut((k - 0.6) / 0.4);
        if (mover.type === 'N') { mover.pose.rear = k < 0.55 ? easeOut(k / 0.55) : 1 - easeOut((k - 0.55) / 0.45); mover.y = 0; }
        else if (mover.type === 'R') {
          mover.pose.attack = up;
          const lunge = k < 0.35 ? -0.12 * easeOut(k / 0.35) : lerp(-0.12, 0.28, easeOut(clamp01((k - 0.35) / 0.25))) * (1 - clamp01((k - 0.6) / 0.4));
          mover.X = stand.X + (dx / dl) * lunge; mover.Z = stand.Z + (dz / dl) * lunge;
        } else {
          mover.pose.attack = up;
          const lunge = Math.sin(Math.PI * clamp01(k / 0.8)) * 0.16;
          mover.X = stand.X + (dx / dl) * lunge; mover.Z = stand.Z + (dz / dl) * lunge;
        }
      } });
      events.push({ t: t + (mover.type === 'N' ? strike * 0.2 : strike * 0.1), fn: () => sfx(mover.type === 'N' ? 'neigh' : mover.type === 'R' ? 'trumpet' : 'whoosh') });
      events.push({ t: hitAt, fn: () => {
        sfx(mover.type === 'R' ? 'crash' : mover.type === 'N' || mover.type === 'B' ? 'thud' : 'clash');
        const now = performance.now();
        effects.push({ kind: 'spark', X: vw.X, Y: 0.55, Z: vw.Z, t0: now, dur: 380, seed: Math.random() });
        if (mover.type === 'Q' || mover.type === 'K' || mover.type === 'P') effects.push({ kind: 'slash', X: vw.X, Y: 0.55, Z: vw.Z, t0: now, dur: 300, dir: mover.facing });
        shakeUntil = now + (mover.type === 'R' ? 420 : 180);
        shakeAmp = mover.type === 'R' ? 7 : 3;
      } });
      // victim: flash, knocked back, topple, vanish in dust
      const fall = 650;
      tracks.push({ t0: hitAt, t1: hitAt + fall, fn: (k) => {
        victim.flash = 1 - clamp01(k * 3);
        victim.X = vw.X + (dx / dl) * easeOut(k) * 0.35;
        victim.Z = vw.Z + (dz / dl) * easeOut(k) * 0.35;
        victim.fall = easeInOut(clamp01((k - 0.15) / 0.6));
        victim.alpha = 1 - clamp01((k - 0.6) / 0.4);
      } });
      events.push({ t: hitAt + fall * 0.55, fn: () => {
        const n = performance.now();
        effects.push({ kind: 'dust', X: victim.X, Y: 0.05, Z: victim.Z, t0: n, dur: 700, seed: Math.random() });
        sfx('fall');
      } });
      events.push({ t: hitAt + fall, fn: () => { victim.dead = true; } });
      t = hitAt + fall * 0.5;
      const finish = 260 + Math.hypot(to.X - stand.X, to.Z - stand.Z) * 160;
      walk(mover, stand, to, t, finish, false);
      events.push({ t, fn: () => { mover.pose.attack = 0; mover.pose.rear = 0; } });
      t += finish;
    } else {
      const dur = knight ? 620 : 260 + dist * 170;
      walk(mover, from, to, 0, dur, knight);
      t = dur;
      // castling: the elephant walks round at the same time
      if (move.flag === E.FLAG.CASTLE_K || move.flag === E.FLAG.CASTLE_Q) {
        const kside = move.flag === E.FLAG.CASTLE_K;
        const rFrom = kside ? move.to + 1 : move.to - 2, rTo = kside ? move.to - 1 : move.to + 1;
        const rook = pieceAt(rFrom);
        if (rook) walk(rook, sqToWorld(rFrom), sqToWorld(rTo), 80, dur, false);
      }
    }
    if (move.promo) {
      events.push({ t, fn: () => {
        effects.push({ kind: 'burst', X: to.X, Y: 0.5, Z: to.Z, t0: performance.now(), dur: 650 });
        mover.type = move.promo.toUpperCase();
        sfx('promote');
      } });
      t += 450;
    }
    events.push({ t: t + 10, fn: () => { mover.y = 0; mover.pose = {}; } });
    return { tracks, events, end: t + 60 };
  }

  function animateMove(move, boardAfter, sfx, done) {
    const tl = buildMoveTimeline(move, boardAfter, sfx || (() => {}));
    if (!tl) { syncPieces(boardAfter); if (done) done(); return; }
    timeline = { ...tl, start: performance.now(), boardAfter, done };
  }

  function stepTimeline(now) {
    if (!timeline) return false;
    const t = now - timeline.start;
    for (const tr of timeline.tracks) {
      if (t < tr.t0) continue;
      const k = tr.t1 > tr.t0 ? clamp01((t - tr.t0) / (tr.t1 - tr.t0)) : 1;
      if (tr.last === 1) continue;
      tr.fn(k);
      tr.last = k;
    }
    for (const ev of timeline.events) if (!ev.fired && t >= ev.t) { ev.fired = true; ev.fn(); }
    if (t >= timeline.end) {
      const { boardAfter, done } = timeline;
      timeline = null;
      // re-sync so the picture always matches the real position
      const keep = new Map(vpieces.filter(v => !v.dead).map(v => [v.sq, v]));
      syncPieces(boardAfter);
      for (const v of vpieces) {
        const old = [...keep.values()].find(o => Math.abs(o.X - v.X) < 0.01 && Math.abs(o.Z - v.Z) < 0.01 && o.type === v.type && o.side === v.side);
        if (old) v.facing = old.facing;
      }
      if (done) done();
    }
    return true;
  }

  // ---------- drawing a frame ----------
  function drawPieceLive(c, v, now) {
    const base = project(v.X, 0, v.Z);
    const s = base.s;
    const lifted = project(v.X, v.y || 0, v.Z);
    const flat = Math.abs(project(v.X, 0, v.Z - 0.3).y - project(v.X, 0, v.Z + 0.3).y) / 0.6;
    const flatK = flat / s;
    // ground shadow (stays on the board while hopping)
    c.save();
    c.globalAlpha = 0.35 * (v.alpha == null ? 1 : v.alpha) / (1 + (v.y || 0) * 2);
    c.beginPath();
    c.ellipse(base.x + s * 0.06, base.y + s * 0.02, s * 0.4, s * 0.4 * flatK, 0, 0, Math.PI * 2);
    c.fillStyle = '#000';
    c.fill();
    c.restore();

    const animated = timeline && (v.pose.walkAmp || v.pose.attack || v.pose.rear || v.fall || v.flash || v.y);
    c.save();
    c.globalAlpha = v.alpha == null ? 1 : v.alpha;
    if (v.fall) {
      // topple away from the attacker around the base
      c.translate(lifted.x, lifted.y);
      c.rotate(-v.facing * v.fall * 1.35);
      c.translate(-lifted.x, -lifted.y);
    }
    if (!animated) {
      const sp = sprite(v.type, v.side, v.facing, s, flatK);
      c.drawImage(sp.cv, lifted.x - sp.ox, lifted.y - sp.oy, sp.w, sp.h);
    } else {
      c.translate(lifted.x, lifted.y);
      c.scale(s, s);
      v.pose.t = now / 1000;
      drawPieceLocal(c, v.type, v.side, v.pose, v.facing, flatK);
    }
    c.restore();
    if (v.flash > 0) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = v.flash * 0.7;
      const g = c.createRadialGradient(lifted.x, lifted.y - s * 0.45, 2, lifted.x, lifted.y - s * 0.45, s * 0.7);
      g.addColorStop(0, 'rgba(255,90,60,0.9)');
      g.addColorStop(1, 'rgba(255,90,60,0)');
      c.fillStyle = g;
      c.fillRect(lifted.x - s, lifted.y - s * 1.3, s * 2, s * 1.6);
      c.restore();
    }
  }

  function squareQuad(sq, inset) {
    const w = sqToWorld(sq), i = inset || 0;
    return [project(w.X - 0.5 + i, 0, w.Z - 0.5 + i), project(w.X + 0.5 - i, 0, w.Z - 0.5 + i),
      project(w.X + 0.5 - i, 0, w.Z + 0.5 - i), project(w.X - 0.5 + i, 0, w.Z + 0.5 - i)];
  }

  function drawHighlights(c, now) {
    const h = highlights;
    if (h.last) for (const sq of [h.last.from, h.last.to]) {
      quad(c, squareQuad(sq));
      c.fillStyle = 'rgba(255,214,90,0.32)';
      c.fill();
    }
    if (h.check >= 0) {
      const w = sqToWorld(h.check), p = project(w.X, 0, w.Z);
      const g = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.s * 0.75);
      g.addColorStop(0, `rgba(255,40,30,${0.65 + 0.25 * Math.sin(now / 160)})`);
      g.addColorStop(1, 'rgba(255,40,30,0)');
      c.fillStyle = g;
      quad(c, squareQuad(h.check));
      c.fill();
    }
    if (h.selected >= 0) {
      quad(c, squareQuad(h.selected, 0.04));
      c.strokeStyle = 'rgba(120,230,255,0.95)';
      c.lineWidth = 3;
      c.stroke();
      c.fillStyle = 'rgba(120,230,255,0.18)';
      c.fill();
    }
    for (const t of h.targets) {
      const w = sqToWorld(t.sq), p = project(w.X, 0, w.Z);
      const ry = Math.abs(project(w.X, 0, w.Z - 0.5).y - project(w.X, 0, w.Z + 0.5).y) / 2;
      c.beginPath();
      if (t.capture) {
        c.ellipse(p.x, p.y, p.s * 0.44, ry * 0.88, 0, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,80,60,0.85)';
        c.lineWidth = 3;
        c.stroke();
      } else {
        c.ellipse(p.x, p.y, p.s * 0.13, ry * 0.26, 0, 0, Math.PI * 2);
        c.fillStyle = 'rgba(20,20,20,0.35)';
        c.fill();
      }
    }
  }

  function drawEffects(c, now) {
    effects = effects.filter(e => now - e.t0 < e.dur);
    for (const e of effects) {
      const k = (now - e.t0) / e.dur;
      const p = project(e.X, e.Y, e.Z);
      if (e.kind === 'spark') {
        const r = rng(Math.floor(e.seed * 1e6));
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
          const a = r() * Math.PI * 2, len = p.s * (0.15 + r() * 0.35) * easeOut(k);
          c.strokeStyle = `rgba(255,${180 + Math.floor(r() * 70)},90,${1 - k})`;
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(p.x + Math.cos(a) * len * 0.4, p.y + Math.sin(a) * len * 0.4);
          c.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
          c.stroke();
        }
        const g = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.s * 0.4);
        g.addColorStop(0, `rgba(255,240,200,${0.9 * (1 - k)})`);
        g.addColorStop(1, 'rgba(255,200,120,0)');
        c.fillStyle = g;
        c.fillRect(p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
        c.restore();
      } else if (e.kind === 'slash') {
        c.save();
        c.globalAlpha = 1 - k;
        c.strokeStyle = '#ffffff';
        c.shadowColor = '#bfe8ff';
        c.shadowBlur = 10 * DPR;
        c.lineWidth = 4 * (1 - k) + 1;
        c.beginPath();
        const r0 = p.s * 0.45;
        const a0 = e.dir > 0 ? -2.4 : -0.7, a1 = e.dir > 0 ? -0.2 : -2.9;
        c.arc(p.x - e.dir * p.s * 0.1, p.y + p.s * 0.1, r0, lerp(a0, a1, 0), lerp(a0, a1, Math.min(1, k * 2.5)), e.dir < 0);
        c.stroke();
        c.restore();
      } else if (e.kind === 'dust') {
        const r = rng(Math.floor(e.seed * 1e6));
        for (let i = 0; i < 12; i++) {
          const a = r() * Math.PI * 2, d = p.s * (0.1 + r() * 0.45) * easeOut(k);
          const rad = p.s * (0.08 + r() * 0.12) * (0.6 + k);
          c.beginPath();
          c.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.4 - k * p.s * 0.2, rad, 0, Math.PI * 2);
          c.fillStyle = `rgba(190,170,140,${0.45 * (1 - k)})`;
          c.fill();
        }
      } else if (e.kind === 'burst') {
        c.save();
        c.globalCompositeOperation = 'lighter';
        const g = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.s * (0.3 + k * 0.9));
        g.addColorStop(0, `rgba(255,236,150,${1 - k})`);
        g.addColorStop(1, 'rgba(255,200,80,0)');
        c.fillStyle = g;
        c.fillRect(p.x - p.s * 1.5, p.y - p.s * 1.5, p.s * 3, p.s * 3);
        for (let i = 0; i < 10; i++) {
          const a = i * Math.PI / 5 + k;
          c.strokeStyle = `rgba(255,230,140,${1 - k})`;
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(p.x + Math.cos(a) * p.s * 0.3, p.y + Math.sin(a) * p.s * 0.3);
          c.lineTo(p.x + Math.cos(a) * p.s * (0.5 + k * 0.6), p.y + Math.sin(a) * p.s * (0.5 + k * 0.6));
          c.stroke();
        }
        c.restore();
      }
    }
  }

  function draw(now) {
    if (!ctx || !cam) return;
    const busy = stepTimeline(now);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    let sx = 0, sy = 0;
    if (now < shakeUntil) {
      const k = (shakeUntil - now) / 400;
      sx = (Math.random() - 0.5) * shakeAmp * k; sy = (Math.random() - 0.5) * shakeAmp * k;
    }
    ctx.translate(sx, sy);
    if (!boardLayer) boardLayer = buildBoard();
    ctx.drawImage(boardLayer, 0, 0, cw, ch);
    drawHighlights(ctx, now);
    // far pieces first
    const order = vpieces.filter(v => !v.dead).sort((a, b) => b.Z - a.Z || a.X - b.X);
    for (const v of order) drawPieceLive(ctx, v, now);
    drawEffects(ctx, now);
    return busy || effects.length > 0 || highlights.check >= 0;
  }

  // ---------- public API ----------
  function init(cv) {
    canvas = cv;
    ctx = cv.getContext('2d');
    resize();
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    cw = Math.max(1, rect.width); ch = Math.max(1, rect.height);
    DPR = Math.min(2, global.devicePixelRatio || 1);
    canvas.width = Math.round(cw * DPR);
    canvas.height = Math.round(ch * DPR);
    cam = setupCamera();
    boardLayer = null;
    spriteCache.clear();
    // keep pieces where they are on the board
    for (const v of vpieces) { const w = sqToWorld(v.sq); if (!timeline) { v.X = w.X; v.Z = w.Z; } }
  }
  function setFlipped(f, board) {
    if (flipped === f) return;
    flipped = f;
    boardLayer = null;
    if (board) syncPieces(board);
  }
  function squareAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    // prefer a piece's body if you click on the figure itself
    const order = vpieces.filter(v => !v.dead).sort((a, b) => a.Z - b.Z);
    for (const v of order) {
      const p = project(v.X, 0, v.Z);
      const h = HEIGHT[v.type] * p.s;
      if (Math.abs(sx - p.x) < p.s * 0.32 && sy < p.y + p.s * 0.1 && sy > p.y - h) return v.sq;
    }
    const w = unproject(sx, sy);
    return worldToSq(w.X, w.Z);
  }

  global.ChessRender = {
    init, resize, draw, setFlipped, squareAt, icon,
    setPosition: (board) => { timeline = null; effects = []; syncPieces(board); },
    animateMove,
    isAnimating: () => !!timeline,
    setHighlights: (h) => { highlights = { ...highlights, ...h }; }
  };
})(window);
