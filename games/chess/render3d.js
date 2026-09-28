/* Real-time 3D chess renderer (three.js / WebGL). Replaces the 2D
   renderer (render.js) whenever WebGL is available, with the same API.

   - Lacquered wooden (or marble) board on a table, warm key light with
     soft shadows, image-based reflections, rotatable/zoomable camera.
   - Two piece sets:
       'armies'  - sculpted characters in polished ivory & gold / ebony &
                   bronze: soldier, war horse, camel, war elephant with a
                   tower, queen, king - with jointed legs, trunk, neck and
                   sword arms so they walk and fight.
       'classic' - a turned Staunton tournament set.
   - Animated moves and captures: each attacker strikes in its own way,
     the victim flashes, is knocked back, topples and vanishes in dust. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const E = window.ChessEngine;
const HEIGHT = { P: 0.78, N: 1.0, B: 1.02, R: 1.08, Q: 1.08, K: 1.2 };

// ---------- bail out to the 2D renderer if WebGL isn't available ----------
function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

if (webglOK()) {
  let renderer, scene, camera, controls, canvas;
  let boardGroup = null, highlightGroup, fxGroup;
  let style = { pieces: 'armies', board: 'wood' };
  let flipped = false;
  let currentBoard = null;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

  function sqPos(sq) { return { x: E.fileOf(sq) - 3.5, z: 3.5 - E.rankOf(sq) }; }

  // ---------- materials ----------
  function makeMaterials() {
    const ivory = new THREE.MeshPhysicalMaterial({ color: 0xe6d8bb, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.22 });
    const ebony = new THREE.MeshPhysicalMaterial({ color: 0x221d1a, roughness: 0.28, clearcoat: 0.85, clearcoatRoughness: 0.12 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b44c, metalness: 1, roughness: 0.25 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0xb87840, metalness: 1, roughness: 0.3 });
    const clothW = new THREE.MeshStandardMaterial({ color: 0x9e1b25, roughness: 0.78, side: THREE.DoubleSide });
    const clothB = new THREE.MeshStandardMaterial({ color: 0x6a0f16, roughness: 0.78, side: THREE.DoubleSide });
    const steel = new THREE.MeshStandardMaterial({ color: 0xe4e8ee, metalness: 1, roughness: 0.18 });
    const tusk = new THREE.MeshPhysicalMaterial({ color: 0xfbf4e2, roughness: 0.35, clearcoat: 0.4 });
    const eyeW = new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.3 });
    const eyeB = new THREE.MeshStandardMaterial({ color: 0xf2c25a, roughness: 0.3, emissive: 0x3a2400 });
    const felt = new THREE.MeshStandardMaterial({ color: 0x1f5a34, roughness: 1 });
    const maneW = new THREE.MeshStandardMaterial({ color: 0xcdb991, roughness: 0.6 });
    const maneB = new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.6 });
    return {
      w: { body: ivory, trim: gold, cloth: clothW, eye: eyeW, mane: maneW },
      b: { body: ebony, trim: bronze, cloth: clothB, eye: eyeB, mane: maneB },
      steel, tusk, felt
    };
  }
  let MAT = null;

  // ---------- geometry helpers ----------
  const geoCache = new Map();
  function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
  function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }
  function lathe(key, pts, mat, segs) {
    return mesh(cached('lathe:' + key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs || 40)), mat);
  }
  function sphere(r, mat, sx, sy, sz) {
    const m = mesh(cached('sph' + r, () => new THREE.SphereGeometry(r, 28, 18)), mat);
    m.scale.set(sx || 1, sy || 1, sz || 1);
    return m;
  }
  // capsule running from point a to point b
  function limb(a, b, r, mat) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = mesh(cached(`cap${r.toFixed(3)}:${len.toFixed(3)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 14)), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return m;
  }
  function cyl(rt, rb, h, mat, open, segs) {
    return mesh(cached(`cyl${rt}:${rb}:${h}:${!!open}`, () => new THREE.CylinderGeometry(rt, rb, h, segs || 32, 1, !!open)), mat);
  }
  function box(w, h, d, mat) { return mesh(cached(`box${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)), mat); }
  function cone(r, h, mat) { return mesh(cached(`cone${r}:${h}`, () => new THREE.ConeGeometry(r, h, 20)), mat); }
  function torus(r, t, mat, arc) { return mesh(cached(`tor${r}:${t}:${arc || 0}`, () => new THREE.TorusGeometry(r, t, 12, 40, arc || Math.PI * 2)), mat); }
  function tube(key, pts, r, mat) {
    return mesh(cached('tube:' + key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 24, r, 10)), mat);
  }
  // a cap of a sphere (thetaLength from the top), used for saddle cloths
  function cap(r, thetaLen, mat, sx, sy, sz) {
    const m = mesh(cached(`capS${r}:${thetaLen}`, () => new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, thetaLen)), mat);
    m.scale.set(sx || 1, sy || 1, sz || 1);
    return m;
  }
  function group(...children) { const g = new THREE.Group(); children.forEach(c => c && g.add(c)); return g; }
  function at(obj, x, y, z) { obj.position.set(x, y, z); return obj; }

  // ---------- the plinth every piece stands on ----------
  function plinth(M) {
    const g = group(
      lathe('plinth', [[0, 0], [0.37, 0], [0.38, 0.018], [0.37, 0.05], [0.34, 0.07], [0.32, 0.085], [0, 0.085]], M.body),
      at(torus(0.355, 0.012, M.trim), 0, 0.045, 0),
      at(cyl(0.36, 0.36, 0.004, MAT.felt), 0, 0.001, 0)
    );
    g.children[1].rotation.x = Math.PI / 2;
    return g;
  }
  const BASE_Y = 0.085;

  // ---------- characters (local: forward = +x, up = +y) ----------
  function buildSoldier(M) {
    const root = new THREE.Group(), parts = {};
    const legL = group(limb([0, 0, 0], [0, -0.24, 0], 0.032, M.body), at(box(0.07, 0.02, 0.045, M.trim), 0.015, -0.265, 0));
    const legR = legL.clone();
    parts.legs = [at(legL, 0, 0.3, -0.045), at(legR, 0, 0.3, 0.045)];
    root.add(...parts.legs);
    root.add(lathe('skirt', [[0, 0.24], [0.115, 0.24], [0.11, 0.28], [0.09, 0.35], [0, 0.35]], M.cloth));
    root.add(lathe('torso', [[0, 0.33], [0.085, 0.33], [0.098, 0.42], [0.092, 0.5], [0.06, 0.545], [0, 0.55]], M.body));
    const belt = at(torus(0.09, 0.013, M.trim), 0, 0.35, 0); belt.rotation.x = Math.PI / 2; root.add(belt);
    root.add(at(sphere(0.045, M.trim, 1.2, 0.8, 1), 0, 0.525, 0.085), at(sphere(0.045, M.trim, 1.2, 0.8, 1), 0, 0.525, -0.085));
    root.add(at(cyl(0.028, 0.03, 0.05, M.body), 0, 0.57, 0));
    root.add(at(sphere(0.062, M.body), 0.005, 0.62, 0));
    const helm = at(cap(0.068, Math.PI / 2, M.trim), 0, 0.625, 0);
    root.add(helm, at(box(0.02, 0.05, 0.13, M.trim), 0.055, 0.6, 0));
    const crest = at(torus(0.07, 0.018, M.cloth, Math.PI), 0, 0.66, 0);
    root.add(crest);
    root.add(at(sphere(0.009, M.eye), 0.058, 0.625, 0.024), at(sphere(0.009, M.eye), 0.058, 0.625, -0.024));
    // spear arm: pivots at the shoulder; the spear turns from upright to a forward thrust
    const arm = new THREE.Group();
    arm.add(limb([0, 0, 0], [0.07, -0.13, 0.01], 0.026, M.body));
    const spear = group(at(cyl(0.009, 0.009, 0.82, new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.6 })), 0, 0.1, 0),
      at(cone(0.022, 0.08, M.trim), 0, 0.55, 0));
    at(spear, 0.075, -0.13, 0.01);
    arm.add(spear);
    parts.arm = at(arm, 0.01, 0.51, 0.1);
    root.add(parts.arm);
    // shield on the left arm
    const shield = group(cyl(0.12, 0.12, 0.018, M.trim), at(cyl(0.085, 0.085, 0.024, M.body), 0, 0, 0), at(sphere(0.03, M.trim), 0, 0.015, 0));
    shield.rotation.x = Math.PI / 2;
    root.add(at(shield, 0.03, 0.42, -0.125));
    root.add(limb([0, 0.51, -0.1], [0.04, 0.42, -0.11], 0.026, M.body));
    return { root, parts };
  }

  function buildHorse(M) {
    const root = new THREE.Group(), parts = {};
    // everything hangs off a pivot at the hind hooves so the horse can rear
    const pivot = at(new THREE.Group(), -0.21, 0, 0);
    const body = at(new THREE.Group(), 0.21, 0, 0);
    pivot.add(body); root.add(pivot); parts.rear = pivot;
    body.add(at(sphere(0.155, M.body, 1.7, 1, 0.82), 0, 0.5, 0));
    body.add(at(sphere(0.13, M.body, 1, 1.05, 0.85), 0.17, 0.52, 0));
    body.add(at(sphere(0.14, M.body, 1, 1, 0.85), -0.17, 0.53, 0));
    body.add(limb([0.2, 0.56, 0], [0.31, 0.8, 0], 0.07, M.body));
    body.add(limb([0.3, 0.86, 0], [0.45, 0.72, 0], 0.052, M.body));
    body.add(at(sphere(0.058, M.body), 0.305, 0.855, 0), at(sphere(0.048, M.body, 1.1, 0.95, 1), 0.46, 0.71, 0));
    const earL = at(cone(0.018, 0.07, M.body), 0.3, 0.93, 0.025), earR = at(cone(0.018, 0.07, M.body), 0.3, 0.93, -0.025);
    earL.rotation.z = earR.rotation.z = 0.25;
    body.add(earL, earR);
    body.add(at(sphere(0.011, M.eye), 0.37, 0.83, 0.045), at(sphere(0.011, M.eye), 0.37, 0.83, -0.045));
    // mane
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const m = at(sphere(0.035, M.mane, 0.8, 1.3, 0.55), lerp(0.28, 0.14, t), lerp(0.9, 0.62, t) + 0.02, 0);
      m.rotation.z = 0.6;
      body.add(m);
    }
    // bridle
    const nose = at(torus(0.05, 0.008, M.trim), 0.43, 0.73, 0); nose.rotation.y = Math.PI / 2; nose.rotation.x = 0.7; body.add(nose);
    // saddle cloth + saddle
    body.add(at(cap(0.17, Math.PI * 0.32, M.cloth, 1.2, 1, 0.95), 0.0, 0.5, 0));
    body.add(at(sphere(0.07, M.trim, 1.3, 0.45, 1), 0, 0.66, 0));
    // tail
    const tail = at(new THREE.Group(), -0.29, 0.58, 0);
    tail.add(tube('htail', [[0, 0, 0], [-0.08, -0.08, 0], [-0.1, -0.2, 0], [-0.08, -0.32, 0]], 0.028, M.mane));
    parts.tail = tail; body.add(tail);
    // legs: upper + knee joint + lower + hoof
    parts.legs = [];
    for (const [x, z] of [[0.17, 0.07], [0.17, -0.07], [-0.18, 0.07], [-0.18, -0.07]]) {
      const leg = at(new THREE.Group(), x, 0.42, z);
      leg.add(limb([0, 0, 0], [0, -0.2, 0], 0.036, M.body));
      const knee = at(new THREE.Group(), 0, -0.2, 0);
      knee.add(limb([0, 0, 0], [0, -0.19, 0], 0.026, M.body), at(cyl(0.032, 0.036, 0.035, M.trim), 0, -0.21, 0));
      leg.add(knee);
      leg.userData.knee = knee;
      parts.legs.push(leg);
      body.add(leg);
    }
    return { root, parts };
  }

  function buildElephant(M) {
    const root = new THREE.Group(), parts = {};
    parts.legs = [];
    for (const [x, z] of [[0.17, 0.1], [0.17, -0.1], [-0.17, 0.1], [-0.17, -0.1]]) {
      const leg = at(new THREE.Group(), x, 0.36, z);
      leg.add(at(cyl(0.062, 0.068, 0.36, M.body), 0, -0.18, 0), at(cyl(0.075, 0.075, 0.03, M.trim), 0, -0.345, 0));
      parts.legs.push(leg); root.add(leg);
    }
    root.add(at(sphere(0.25, M.body, 1.3, 0.95, 0.95), 0, 0.5, 0));
    // caparison cloth with a gold hem
    root.add(at(cap(0.262, Math.PI * 0.42, M.cloth, 1.3, 0.95, 0.97), 0, 0.5, 0));
    const hem = at(torus(0.2, 0.012, M.trim), 0, 0.49, 0); hem.rotation.x = Math.PI / 2; hem.scale.set(1.63, 1.19, 1); root.add(hem);
    root.add(at(sphere(0.15, M.body), 0.3, 0.56, 0));
    const earL = at(sphere(0.15, M.body, 0.18, 1, 0.9), 0.23, 0.57, 0.14), earR = at(sphere(0.15, M.body, 0.18, 1, 0.9), 0.23, 0.57, -0.14);
    earL.rotation.y = -0.4; earR.rotation.y = 0.4;
    root.add(earL, earR);
    root.add(at(sphere(0.013, M.eye), 0.39, 0.6, 0.07), at(sphere(0.013, M.eye), 0.39, 0.6, -0.07));
    root.add(tube('tuskL', [[0.37, 0.48, 0.06], [0.47, 0.4, 0.08], [0.54, 0.44, 0.08]], 0.016, MAT.tusk));
    root.add(tube('tuskR', [[0.37, 0.48, -0.06], [0.47, 0.4, -0.08], [0.54, 0.44, -0.08]], 0.016, MAT.tusk));
    // trunk: a chain of joints that hangs down and curls up to charge
    parts.trunk = [];
    let parent = root, base = [0.42, 0.52, 0];
    const radii = [0.052, 0.044, 0.036, 0.028, 0.022];
    radii.forEach((r, i) => {
      const j = at(new THREE.Group(), ...base);
      j.add(limb([0, 0, 0], [0.0, -0.085, 0], r, M.body));
      parent.add(j);
      parts.trunk.push(j);
      parent = j;
      base = [0, -0.085, 0];
      j.rotation.z = i === 0 ? 0.35 : 0.12; // hangs forward and down
    });
    root.add(tube('etail', [[-0.32, 0.52, 0], [-0.37, 0.4, 0], [-0.36, 0.3, 0]], 0.012, M.body));
    // the tower on its back - the rook's castle
    const tower = at(new THREE.Group(), -0.03, 0.72, 0);
    tower.add(at(cyl(0.2, 0.2, 0.03, M.trim), 0, 0, 0));
    tower.add(at(cyl(0.14, 0.15, 0.24, M.body), 0, 0.135, 0));
    tower.add(at(cyl(0.165, 0.165, 0.035, M.trim), 0, 0.26, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const mer = at(box(0.05, 0.06, 0.045, M.body), Math.cos(a) * 0.14, 0.305, Math.sin(a) * 0.14);
      mer.rotation.y = -a;
      tower.add(mer);
    }
    tower.add(at(box(0.012, 0.07, 0.04, new THREE.MeshStandardMaterial({ color: 0x0d0906 })), 0.142, 0.13, 0));
    root.add(tower);
    return { root, parts };
  }

  function buildCamel(M) {
    const root = new THREE.Group(), parts = {};
    parts.legs = [];
    for (const [x, z] of [[0.15, 0.06], [0.15, -0.06], [-0.15, 0.06], [-0.15, -0.06]]) {
      const leg = at(new THREE.Group(), x, 0.56, z);
      leg.add(limb([0, 0, 0], [0, -0.26, 0], 0.028, M.body));
      const knee = at(new THREE.Group(), 0, -0.26, 0);
      knee.add(at(sphere(0.03, M.body), 0, 0, 0), limb([0, 0, 0], [0, -0.26, 0], 0.022, M.body), at(sphere(0.035, M.body, 1.3, 0.5, 1), 0.01, -0.285, 0));
      leg.add(knee); leg.userData.knee = knee;
      parts.legs.push(leg); root.add(leg);
    }
    root.add(at(sphere(0.17, M.body, 1.45, 0.82, 0.78), 0, 0.63, 0));
    root.add(at(sphere(0.13, M.body, 1.15, 1, 0.9), -0.02, 0.74, 0));
    root.add(at(cap(0.14, Math.PI * 0.5, M.cloth, 1.2, 1.05, 0.95), -0.02, 0.72, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      root.add(at(cone(0.012, 0.05, M.trim), -0.02 + Math.cos(a) * 0.15, 0.68, Math.sin(a) * 0.13));
    }
    root.add(tube('ctail', [[-0.24, 0.65, 0], [-0.29, 0.55, 0], [-0.28, 0.45, 0]], 0.012, M.body));
    // neck lunges forward to bite
    const neck = at(new THREE.Group(), 0.2, 0.64, 0);
    neck.add(limb([0, 0, 0], [0.13, -0.05, 0], 0.052, M.body));
    neck.add(limb([0.13, -0.05, 0], [0.2, 0.2, 0], 0.045, M.body));
    neck.add(limb([0.19, 0.24, 0], [0.32, 0.2, 0], 0.042, M.body));
    neck.add(at(sphere(0.05, M.body), 0.19, 0.24, 0));
    const e1 = at(cone(0.014, 0.04, M.body), 0.17, 0.3, 0.025), e2 = at(cone(0.014, 0.04, M.body), 0.17, 0.3, -0.025);
    neck.add(e1, e2);
    neck.add(at(sphere(0.01, M.eye), 0.23, 0.26, 0.04), at(sphere(0.01, M.eye), 0.23, 0.26, -0.04));
    const halter = at(torus(0.043, 0.007, M.trim), 0.28, 0.21, 0); halter.rotation.y = Math.PI / 2; neck.add(halter);
    parts.neck = neck; root.add(neck);
    return { root, parts };
  }

  function buildRoyal(M, king) {
    const root = new THREE.Group(), parts = {};
    const s = king ? 1.08 : 1;
    const robe = king
      ? [[0, 0], [0.19, 0], [0.18, 0.05], [0.15, 0.3], [0.12, 0.5], [0.09, 0.6], [0, 0.6]]
      : [[0, 0], [0.2, 0], [0.19, 0.04], [0.14, 0.2], [0.1, 0.4], [0.075, 0.55], [0, 0.56]];
    root.add(lathe(king ? 'krobe' : 'qgown', robe, M.body));
    const hem = at(torus(0.19, 0.014, M.trim), 0, 0.02, 0); hem.rotation.x = Math.PI / 2; root.add(hem);
    const top = king ? 0.6 : 0.56;
    root.add(lathe(king ? 'kbody' : 'qbody', [[0, top - 0.01], [0.08, top], [0.09, top + 0.1], [0.075 * s, top + 0.18], [0.045, top + 0.22], [0, top + 0.225]], M.body));
    const belt = at(torus(0.085, 0.013, M.trim), 0, top + 0.02, 0); belt.rotation.x = Math.PI / 2; root.add(belt);
    // cape behind the shoulders
    const cape = mesh(cached(king ? 'kcape' : 'qcape', () => new THREE.CylinderGeometry(0.1, 0.2, top + 0.2, 24, 1, true, Math.PI * 0.5, Math.PI)), M.cloth);
    at(cape, -0.02, (top + 0.2) / 2, 0);
    root.add(cape);
    const neckY = top + 0.245, headY = neckY + 0.07;
    root.add(at(cyl(0.026, 0.03, 0.05, M.body), 0, neckY, 0));
    root.add(at(sphere(0.066, M.body), 0.005, headY, 0));
    root.add(at(sphere(0.009, M.eye), 0.06, headY + 0.005, 0.024), at(sphere(0.009, M.eye), 0.06, headY + 0.005, -0.024));
    if (king) {
      const beard = at(cone(0.05, 0.1, M.body), 0.035, headY - 0.07, 0); beard.rotation.z = Math.PI; root.add(beard);
    } else {
      root.add(at(sphere(0.07, M.body, 0.9, 1.25, 1), -0.025, headY - 0.03, 0));
    }
    // crown
    const crownY = headY + 0.055;
    root.add(at(cyl(0.062, 0.058, king ? 0.05 : 0.035, M.trim, true), 0, crownY, 0));
    const pts = king ? 5 : 6;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      root.add(at(cone(0.016, king ? 0.07 : 0.05, M.trim), Math.cos(a) * 0.058, crownY + (king ? 0.055 : 0.04), Math.sin(a) * 0.058));
    }
    root.add(at(sphere(0.016, M.cloth), 0.06, crownY, 0));
    if (king) {
      root.add(at(box(0.016, 0.09, 0.016, M.trim), 0, crownY + 0.12, 0), at(box(0.06, 0.016, 0.016, M.trim), 0, crownY + 0.13, 0));
      root.add(at(sphere(0.035, M.trim), 0.07, top + 0.06, -0.14));
    }
    // arms: the left rests, the right swings the sword
    root.add(limb([0, top + 0.19, -0.09], [0.06, top + 0.05, -0.13], 0.026, M.body));
    const arm = at(new THREE.Group(), 0, top + 0.19, 0.095);
    arm.add(limb([0, 0, 0], [0.09, -0.12, 0.01], 0.026, M.body));
    const sword = at(new THREE.Group(), 0.095, -0.13, 0.01);
    sword.add(at(box(0.024, 0.46, 0.008, MAT.steel), 0, 0.28, 0), at(box(0.1, 0.018, 0.024, M.trim), 0, 0.05, 0),
      at(cyl(0.012, 0.012, 0.06, M.trim), 0, 0.015, 0), at(sphere(0.018, M.trim), 0, -0.02, 0));
    sword.rotation.z = -0.25;
    arm.add(sword);
    parts.arm = arm;
    root.add(arm);
    return { root, parts };
  }

  // ---------- classic Staunton set ----------
  function buildClassic(type, M) {
    const root = new THREE.Group();
    const base = [[0, 0], [0.3, 0], [0.31, 0.03], [0.28, 0.06], [0.24, 0.08], [0.2, 0.1]];
    if (type === 'P') {
      root.add(lathe('cP', [...base, [0.13, 0.2], [0.1, 0.3], [0.15, 0.32], [0.15, 0.34], [0.08, 0.36], [0, 0.36]], M.body));
      root.add(at(sphere(0.105, M.body), 0, 0.45, 0));
    } else if (type === 'R') {
      root.add(lathe('cR', [...base, [0.17, 0.2], [0.16, 0.42], [0.2, 0.46], [0.2, 0.56], [0.15, 0.56], [0.15, 0.53], [0, 0.53]], M.body));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const mer = at(box(0.075, 0.07, 0.06, M.body), Math.cos(a) * 0.17, 0.59, Math.sin(a) * 0.17);
        mer.rotation.y = -a; root.add(mer);
      }
    } else if (type === 'B') {
      root.add(lathe('cB', [...base, [0.12, 0.3], [0.09, 0.46], [0.15, 0.49], [0.15, 0.52], [0.07, 0.54], [0, 0.54]], M.body));
      root.add(at(sphere(0.11, M.body, 0.9, 1.45, 0.9), 0, 0.68, 0));
      root.add(at(sphere(0.035, M.body), 0, 0.86, 0));
    } else if (type === 'Q' || type === 'K') {
      const k = type === 'K';
      root.add(lathe(k ? 'cK' : 'cQ', [...base, [0.14, 0.3], [0.1, 0.62], [0.17, 0.66], [0.17, 0.69], [0.1, 0.71], [0.15, 0.8], [0.16, 0.84], [0, 0.84]], M.body));
      if (k) {
        root.add(at(box(0.05, 0.2, 0.05, M.body), 0, 0.95, 0), at(box(0.16, 0.05, 0.05, M.body), 0, 0.97, 0));
      } else {
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; root.add(at(sphere(0.03, M.body), Math.cos(a) * 0.14, 0.86, Math.sin(a) * 0.14)); }
        root.add(at(sphere(0.06, M.body), 0, 0.9, 0));
      }
    } else if (type === 'N') {
      root.add(lathe('cN', [...base, [0.17, 0.2], [0.15, 0.26], [0, 0.26]], M.body));
      const shape = new THREE.Shape();
      shape.moveTo(-0.14, 0); shape.lineTo(0.16, 0);
      shape.quadraticCurveTo(0.12, 0.16, 0.2, 0.26);
      shape.lineTo(0.28, 0.33); shape.quadraticCurveTo(0.3, 0.4, 0.22, 0.42);
      shape.quadraticCurveTo(0.12, 0.55, 0.0, 0.58); shape.lineTo(-0.03, 0.64); shape.lineTo(-0.07, 0.56);
      shape.quadraticCurveTo(-0.2, 0.44, -0.14, 0);
      const head = mesh(cached('cNhead', () => new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 5, curveSegments: 18 })), M.body);
      head.position.set(0, 0.24, -0.06);
      root.add(head);
    }
    return { root, parts: {} };
  }

  // ---------- Ramayan set: Ram's army (white) vs Ravana's army (black) ----------
  function ramMaterials() {
    const std = (color, rough, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough == null ? 0.55 : rough }, extra || {}));
    const skinMat = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.48, clearcoat: 0.15, sheen: 0.4, sheenColor: new THREE.Color(0xffd8c0), sheenRoughness: 0.6 });
    const fabric = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.8, sheen: 0.35, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), sheenRoughness: 0.7, side: THREE.DoubleSide });
    const fur = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
    const gold = std(0xf0c14f, 0.22, { metalness: 1 });
    const bronze = std(0xc07a3a, 0.28, { metalness: 1 });
    const shared = {
      white: std(0xfbf6e8, 0.35), iris: std(0x1c120a, 0.2), lip: std(0xb04a4a, 0.45), red: std(0xc8102e, 0.35),
      ruby: std(0xd0103a, 0.1, { metalness: 0.2, emissive: 0x300008 }), emerald: std(0x1f9e5a, 0.1, { metalness: 0.2 }),
      pearl: new THREE.MeshPhysicalMaterial({ color: 0xfaf4ea, roughness: 0.15, clearcoat: 1 }),
      steel: MAT.steel
    };
    return {
      w: Object.assign({}, shared, {
        body: MAT.w.body, trim: gold, cloth: MAT.w.cloth, eye: MAT.w.eye, mane: MAT.w.mane,
        skin: { ram: skinMat(0x3c6fd8), fair: skinMat(0xe8b48c), monkey: fur(0xc9853a), face: skinMat(0xefc39a), bear: fur(0x3e2b1f), bearFace: fur(0x6e4e36) },
        cloth1: fabric(0xf6c33c),   // pitambar yellow
        cloth2: fabric(0xef7b1a),   // saffron
        saree: fabric(0xc01d35), border: gold,
        hair: std(0x160f0a, 0.55), wood: std(0x6b4524, 0.55), string: std(0xf4ecd8, 0.4), green: fur(0x3f7d3a), pink: std(0xff8fb8, 0.45)
      }),
      b: Object.assign({}, shared, {
        body: MAT.b.body, trim: bronze, cloth: MAT.b.cloth, eye: MAT.b.eye, mane: MAT.b.mane,
        skin: { ravana: skinMat(0x3a2418), fair: skinMat(0x8a6448), demon: skinMat(0x2a1c26), giant: skinMat(0x2e2019), deer: std(0xe8b030, 0.25, { metalness: 0.7 }), face: skinMat(0x2a1c26) },
        cloth1: fabric(0x0e0a0b),   // black
        cloth2: fabric(0x5a0c16),   // blood red
        saree: fabric(0x1a0d1e), border: bronze,
        hair: std(0x080606, 0.55), wood: std(0x2e1c10, 0.55), string: std(0xd8ccb0, 0.4), green: fur(0x2f4a2a), pink: std(0x9b2a4a, 0.45),
        redEye: std(0xff3020, 0.3, { emissive: 0xaa1000 })
      })
    };
  }

  // small decorative parts don't need to cast shadows
  function deco(m) { m.castShadow = false; return m; }
  function curve(key, pts, r, mat) { return tube(key, pts, r, mat); }

  // ----- heads -----
  // a human face looking along +x: skull, jaw, nose, brows, eyes with irises, lips, ears, hair
  function humanHead(M, o, s) {
    const g = new THREE.Group();
    g.scale.setScalar(s || 1);
    const skin = o.faceSkin || o.skin;
    g.add(sphere(0.062, skin, 0.96, 1.1, 0.9));                              // skull
    g.add(at(sphere(0.045, skin, 1.05, 0.9, 0.92), 0.018, -0.03, 0));        // jaw / chin
    const nose = at(cone(0.011, 0.03, skin), 0.064, -0.004, 0); nose.rotation.z = -Math.PI / 2 + 0.2; g.add(nose);
    for (const z of [-1, 1]) {
      g.add(deco(at(sphere(0.012, M.white, 1, 0.8, 1), 0.051, 0.012, z * 0.022)));   // eye white
      g.add(deco(at(sphere(0.0065, o.redEye ? M.redEye : M.iris), 0.061, 0.012, z * 0.022)));  // iris
      const brow = deco(at(box(0.006, 0.005, 0.024, M.hair), 0.058, 0.028, z * 0.023)); brow.rotation.x = z * 0.15; g.add(brow);
      g.add(at(sphere(0.014, skin, 0.5, 1.2, 0.7), -0.004, 0.0, z * 0.062));   // ear
      if (o.earrings !== false) { const k = deco(at(torus(0.011, 0.003, M.trim), -0.002, -0.024, z * 0.066)); k.rotation.y = Math.PI / 2; g.add(k); }
    }
    g.add(deco(at(sphere(0.013, M.lip, 0.6, 0.35, 1.2), 0.058, -0.03, 0)));     // lips
    if (o.mustache) for (const z of [-1, 1]) g.add(deco(curve('mus' + z, [[0.062, -0.02, 0], [0.06, -0.022, z * 0.018], [0.05, -0.012, z * 0.038]], 0.004, M.hair)));
    if (o.tilak) {
      g.add(deco(at(box(0.003, 0.02, 0.003, M.white), 0.061, 0.045, 0.006)), deco(at(box(0.003, 0.02, 0.003, M.white), 0.061, 0.045, -0.006)));
      g.add(deco(at(box(0.003, 0.018, 0.003, M.red), 0.062, 0.044, 0)));
    }
    if (o.bindi) g.add(deco(at(sphere(0.004, M.red), 0.061, 0.036, 0)));
    // hair: cap + (optionally) long hair down the back
    g.add(at(sphere(0.065, M.hair, 0.98, 1.0, 0.95), -0.014, 0.014, 0));
    if (o.longHair) g.add(at(sphere(0.06, M.hair, 0.7, 1.6, 1.05), -0.04, -0.07, 0));
    if (o.braid) g.add(curve('braid', [[-0.05, 0, 0], [-0.07, -0.1, 0], [-0.07, -0.22, 0.01], [-0.06, -0.3, 0]], 0.014, M.hair));
    if (o.wildHair) for (let i = 0; i < 9; i++) {
      const a = -1.2 + i * 0.3;
      const sp = at(cone(0.012, 0.06, M.hair), -0.01 + Math.cos(a) * -0.02, 0.05 + Math.cos(a) * 0.02, Math.sin(a) * 0.06);
      sp.rotation.set(Math.sin(a) * 0.9, 0, 0.5); g.add(sp);
    }
    if (o.tusks) for (const z of [-1, 1]) { const t = deco(at(cone(0.006, 0.03, M.white), 0.056, -0.028, z * 0.016)); g.add(t); }
    if (o.horns) for (const z of [-1, 1]) g.add(curve('horn' + z, [[0, 0.05, z * 0.035], [0.0, 0.09, z * 0.055], [0.03, 0.12, z * 0.05]], 0.009, M.white));
    return g;
  }

  function monkeyHead(M, o, s) {
    const g = new THREE.Group();
    g.scale.setScalar(s || 1);
    const fur = o.skin, face = M.skin.face;
    g.add(sphere(0.064, fur, 1, 1.05, 0.95));
    g.add(at(sphere(0.05, face, 0.8, 0.9, 1.05), 0.03, -0.005, 0));            // face mask
    g.add(at(sphere(0.036, face, 1.15, 0.8, 1.05), 0.058, -0.026, 0));         // muzzle
    g.add(deco(at(box(0.012, 0.01, 0.07, fur), 0.056, 0.024, 0)));             // brow ridge
    for (const z of [-1, 1]) {
      g.add(deco(at(sphere(0.011, M.white, 1, 0.85, 1), 0.058, 0.01, z * 0.02)));
      g.add(deco(at(sphere(0.0065, M.iris), 0.066, 0.01, z * 0.02)));
      g.add(at(sphere(0.022, face, 0.5, 1.1, 1), 0.0, 0.004, z * 0.066));       // round ears
      g.add(deco(at(sphere(0.018, fur, 0.8, 1.2, 0.8), 0.03, -0.02, z * 0.05)));  // cheek fur
      g.add(deco(at(sphere(0.004, M.iris), 0.093, -0.02, z * 0.008)));          // nostrils
      if (o.earrings) { const k = deco(at(torus(0.012, 0.003, M.trim), 0, -0.02, z * 0.07)); k.rotation.y = Math.PI / 2; g.add(k); }
    }
    g.add(deco(at(box(0.004, 0.003, 0.03, M.iris), 0.086, -0.044, 0)));          // mouth
    return g;
  }

  function bearHead(M, o, s) {
    const g = new THREE.Group();
    g.scale.setScalar(s || 1);
    g.add(sphere(0.068, o.skin, 1, 1, 0.98));
    g.add(at(sphere(0.036, M.skin.bearFace, 1.35, 0.8, 1), 0.066, -0.022, 0));
    g.add(deco(at(sphere(0.014, M.iris, 1.2, 0.8, 1.2), 0.11, -0.012, 0)));
    for (const z of [-1, 1]) {
      g.add(deco(at(sphere(0.009, M.iris), 0.058, 0.016, z * 0.028)));
      g.add(at(sphere(0.022, o.skin, 0.6, 1, 1), -0.01, 0.062, z * 0.046));
      g.add(deco(at(sphere(0.012, M.skin.bearFace, 0.5, 1, 1), -0.004, 0.062, z * 0.046)));
    }
    for (let i = 0; i < 10; i++) {                                              // shaggy mane
      const a = (i / 10) * Math.PI * 2;
      g.add(deco(at(sphere(0.026, o.skin, 0.8, 1.2, 0.8), -0.03 + Math.cos(a) * 0.01, -0.035 + Math.sin(a) * 0.02, Math.sin(a) * 0.055)));
    }
    return g;
  }

  // ----- crowns -----
  function mukut(M, h) {
    const g = new THREE.Group();
    h = h || 1;
    g.add(at(cyl(0.066, 0.064, 0.03, M.trim, true), 0, 0, 0));
    const band = deco(at(torus(0.066, 0.005, M.trim), 0, -0.012, 0)); band.rotation.x = Math.PI / 2; g.add(band);
    g.add(at(lathe('kirit' + h, [[0, 0], [0.062, 0], [0.058, 0.04 * h], [0.045, 0.09 * h], [0.03, 0.14 * h], [0.016, 0.18 * h], [0, 0.2 * h]], M.trim, 24), 0, 0.012, 0));
    for (let i = 0; i < 4; i++) { const r = deco(at(torus(0.06 - i * 0.011, 0.003, M.trim), 0, 0.03 + i * 0.04 * h, 0)); r.rotation.x = Math.PI / 2; g.add(r); }
    g.add(deco(at(sphere(0.02, M.ruby, 0.5, 1.2, 1), 0.058, 0.03, 0)));           // front jewel
    for (const z of [-1, 1]) g.add(deco(at(sphere(0.01, M.emerald), 0.045, 0.02, z * 0.04)));
    const fan = deco(at(torus(0.05, 0.006, M.trim, Math.PI), 0.02, 0.045, 0)); fan.rotation.y = Math.PI / 2; g.add(fan);  // halo plate
    g.add(deco(at(sphere(0.014, M.pearl), 0, 0.2 * h + 0.012, 0)));
    return g;
  }
  function tiara(M) {
    const g = new THREE.Group();
    g.add(at(cyl(0.064, 0.066, 0.022, M.trim, true), 0, 0, 0));
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3;
      g.add(deco(at(cone(0.01, 0.04 + (i === 3 ? 0.03 : 0), M.trim), Math.cos(a) * 0.062, 0.03, Math.sin(a) * 0.062)));
    }
    g.add(deco(at(sphere(0.013, M.ruby), 0.063, 0.015, 0)));
    const chain = deco(curve('mangtika', [[0.05, 0.02, 0], [0.062, -0.01, 0], [0.066, -0.03, 0]], 0.002, M.trim)); g.add(chain);
    g.add(deco(at(sphere(0.006, M.pearl), 0.067, -0.034, 0)));
    return g;
  }

  // ----- weapons & props (built along +y from the grip) -----
  function bow(M) {
    const g = new THREE.Group();
    const pts = [[0.02, -0.26, 0], [0.07, -0.18, 0], [0.06, -0.06, 0], [0.04, 0, 0], [0.06, 0.06, 0], [0.07, 0.18, 0], [0.02, 0.26, 0]];
    g.add(curve('bowlimb', pts, 0.009, M.wood));
    g.add(deco(at(box(0.002, 0.52, 0.002, M.string), -0.0, 0, 0)));
    for (const y of [-0.26, 0.26]) g.add(deco(at(sphere(0.012, M.trim), 0.02, y, 0)));
    g.add(deco(at(cyl(0.013, 0.013, 0.05, M.trim), 0.045, 0, 0)));
    g.position.y = 0.06;
    return g;
  }
  function gada(M) {
    const g = new THREE.Group();
    g.add(at(cyl(0.012, 0.012, 0.3, M.trim), 0, 0.12, 0));
    for (const y of [0.02, 0.12, 0.22]) { const r = deco(at(torus(0.014, 0.004, M.trim), 0, y, 0)); r.rotation.x = Math.PI / 2; g.add(r); }
    g.add(at(lathe('gadahead', [[0, 0], [0.03, 0.005], [0.07, 0.04], [0.078, 0.08], [0.065, 0.12], [0.035, 0.15], [0.015, 0.17], [0, 0.18]], M.trim), 0, 0.26, 0));
    for (let i = 0; i < 8; i++) { const r = deco(at(box(0.004, 0.1, 0.004, M.trim), Math.cos(i * 0.785) * 0.075, 0.34, Math.sin(i * 0.785) * 0.075)); g.add(r); }
    g.add(deco(at(sphere(0.016, M.ruby), 0, 0.45, 0)));
    return g;
  }
  function club(M, spiked) {
    const g = new THREE.Group();
    g.add(at(cyl(0.045, 0.016, 0.38, M.wood), 0, 0.17, 0));
    for (const y of [0.1, 0.22, 0.3]) g.add(deco(at(sphere(0.02, M.wood), 0.03, y, (y * 7 % 2 ? 1 : -1) * 0.02)));
    if (spiked) for (let i = 0; i < 10; i++) { const a = i * 1.3, y = 0.22 + (i % 4) * 0.035; const sp = deco(at(cone(0.008, 0.035, M.steel), Math.cos(a) * 0.04, y, Math.sin(a) * 0.04)); sp.rotation.set(Math.sin(a) * 1.5, 0, -Math.cos(a) * 1.5); g.add(sp); }
    const band = deco(at(torus(0.03, 0.006, M.trim), 0, 0.24, 0)); band.rotation.x = Math.PI / 2; g.add(band);
    return g;
  }
  function trident(M) {
    const g = new THREE.Group();
    g.add(at(cyl(0.007, 0.007, 0.5, M.wood), 0, 0.2, 0));
    g.add(deco(at(box(0.012, 0.012, 0.09, M.steel), 0, 0.44, 0)));
    for (const z of [-0.042, 0, 0.042]) { const p = deco(at(cone(0.011, 0.08, M.steel), 0, 0.49 + (z ? 0 : 0.02), z)); g.add(p); }
    g.add(deco(at(sphere(0.012, M.trim), 0, 0.42, 0)));
    return g;
  }
  function sword(M) {
    const g = new THREE.Group();
    g.add(at(box(0.026, 0.42, 0.007, M.steel), 0, 0.26, 0), deco(at(cone(0.013, 0.04, M.steel), 0, 0.49, 0)));
    g.add(at(box(0.11, 0.018, 0.026, M.trim), 0, 0.05, 0), at(cyl(0.011, 0.011, 0.06, M.trim), 0, 0.015, 0), deco(at(sphere(0.018, M.ruby), 0, -0.02, 0)));
    return g;
  }
  function lotus(M) {
    const g = new THREE.Group();
    g.add(at(cyl(0.005, 0.005, 0.16, M.green), 0, 0.06, 0));
    for (let i = 0; i < 8; i++) {
      const a = i * 0.785, pt = deco(at(sphere(0.026, M.pink, 0.5, 1.2, 0.5), Math.cos(a) * 0.018, 0.17, Math.sin(a) * 0.018));
      pt.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); g.add(pt);
    }
    g.add(deco(at(sphere(0.012, M.trim), 0, 0.17, 0)));
    return g;
  }
  function quiver(M) {
    const g = new THREE.Group();
    g.add(at(cyl(0.026, 0.02, 0.22, M.wood), 0, 0, 0));
    for (const y of [-0.08, 0.08]) { const r = deco(at(torus(0.026, 0.004, M.trim), 0, y, 0)); r.rotation.x = Math.PI / 2; g.add(r); }
    for (let i = 0; i < 4; i++) {
      g.add(deco(at(cyl(0.003, 0.003, 0.08, M.wood), (i - 1.5) * 0.008, 0.14, (i % 2) * 0.008)));
      g.add(deco(at(cone(0.008, 0.03, M.red), (i - 1.5) * 0.008, 0.19, (i % 2) * 0.008)));
    }
    return g;
  }
  function mountain(M) {
    const g = new THREE.Group();
    g.add(at(cone(0.1, 0.17, M.green), 0, 0.085, 0), at(cone(0.06, 0.11, M.green), 0.05, 0.09, 0.05), at(cone(0.05, 0.09, M.green), -0.04, 0.06, -0.05));
    for (let i = 0; i < 4; i++) g.add(deco(at(sphere(0.012, i % 2 ? M.pink : M.trim), Math.cos(i * 1.6) * 0.06, 0.08 + i * 0.015, Math.sin(i * 1.6) * 0.06)));
    return g;
  }

  // ----- the figure -----
  // o: {skin, cloth, cloth2, head:'human'|'monkey'|'bear', crown, heads, weapon, left, gown, belly, tail, s, armor, cape, ...face options}
  function buildHero(M, o) {
    const root = new THREE.Group(), fig = new THREE.Group(), parts = {};
    root.add(fig);
    fig.scale.setScalar(o.s || 1);
    const skin = o.skin, cl = o.cloth || M.cloth1, cl2 = o.cloth2 || M.cloth2;
    const bulk = o.belly ? 1.35 : o.muscular ? 1.15 : 1;
    const limbSkin = o.skinArm || skin;

    // legs pivot at the hips (thigh, shin, anklet, foot)
    parts.legs = [];
    for (const z of [-0.048, 0.048]) {
      const leg = at(new THREE.Group(), 0, 0.32, z * bulk);
      leg.add(limb([0, 0, 0], [0.006, -0.15, 0], 0.036 * bulk, limbSkin), limb([0.006, -0.15, 0], [0, -0.29, 0], 0.028 * bulk, limbSkin));
      const ank = deco(at(torus(0.027, 0.005, M.trim), 0, -0.285, 0)); ank.rotation.x = Math.PI / 2; leg.add(ank);
      leg.add(at(sphere(0.03, limbSkin, 1.6, 0.55, 1), 0.02, -0.308, 0));
      parts.legs.push(leg); fig.add(leg);
    }
    // lower garment: flowing saree / dhoti with a gold border and front pleats
    if (o.gown) {
      fig.add(lathe('rgown2', [[0, 0.005], [0.18, 0.005], [0.172, 0.04], [0.14, 0.16], [0.11, 0.3], [0.09, 0.42], [0.08, 0.5], [0, 0.51]], cl, 36));
      const hem = deco(at(torus(0.176, 0.009, M.border), 0, 0.02, 0)); hem.rotation.x = Math.PI / 2; fig.add(hem);
      const mid = deco(at(torus(0.125, 0.006, M.border), 0, 0.2, 0)); mid.rotation.x = Math.PI / 2; fig.add(mid);
    } else {
      fig.add(lathe(o.belly ? 'rdhotiB' : 'rdhoti2', [[0, 0.12], [0.1 * bulk, 0.12], [0.118 * bulk, 0.18], [0.11 * bulk, 0.28], [0.1 * bulk, 0.35], [0, 0.35]], cl, 32));
      const hem = deco(at(torus(0.1 * bulk, 0.007, M.border), 0, 0.125, 0)); hem.rotation.x = Math.PI / 2; fig.add(hem);
      fig.add(at(box(0.012, 0.2, 0.05, cl2), 0.105 * bulk, 0.22, 0));             // front pleat fall
    }
    // torso: chest, shoulders, belly
    const torsoMat = o.gown ? o.blouse || cl : skin;
    fig.add(lathe(o.belly ? 'rtorsoB2' : 'rtorso2', o.belly
      ? [[0, 0.34], [0.11, 0.34], [0.15, 0.42], [0.13, 0.5], [0.09, 0.56], [0.05, 0.585], [0, 0.59]]
      : [[0, 0.34], [0.074, 0.34], [0.086, 0.4], [0.098, 0.47], [0.094, 0.52], [0.06, 0.565], [0, 0.575]], torsoMat, 32));
    if (!o.gown) for (const z of [-1, 1]) fig.add(at(sphere(0.042 * bulk, skin, 0.7, 0.7, 0.9), 0.045 * bulk, 0.49, z * 0.042 * bulk)); // chest
    if (o.belly) fig.add(at(sphere(0.13, skin, 1, 0.9, 1), 0.05, 0.42, 0));
    for (const z of [-1, 1]) fig.add(at(sphere(0.04 * bulk, o.armor ? M.trim : limbSkin), 0, 0.535, z * 0.1 * bulk)); // shoulders
    if (o.armor) {
      fig.add(at(lathe('armor', [[0, 0.4], [0.1, 0.4], [0.105, 0.47], [0.098, 0.53], [0.06, 0.57], [0, 0.575]], M.trim, 28), 0.004, 0, 0));
      fig.add(deco(at(sphere(0.022, M.ruby, 0.5, 1, 1), 0.1, 0.48, 0)));
    }
    if (o.gown) {
      // pallu draped over the left shoulder
      fig.add(curve('pallu', [[0.08, 0.35, 0.06], [0.07, 0.46, -0.02], [0.02, 0.56, -0.09], [-0.07, 0.48, -0.1], [-0.1, 0.3, -0.08]], 0.028, cl));
    }
    // waist sash with a knot, sacred thread, necklaces, angavastram
    const sash = deco(at(torus(0.1 * bulk, 0.013, cl2), 0, o.gown ? 0.34 : 0.36, 0)); sash.rotation.x = Math.PI / 2; fig.add(sash);
    if (!o.gown) fig.add(deco(at(sphere(0.02, cl2, 1, 1.4, 1), 0.1 * bulk, 0.33, 0.03)));
    if (o.janeu) fig.add(deco(curve('janeu', [[0.05, 0.56, -0.07], [0.09, 0.48, -0.02], [0.105, 0.4, 0.04], [0.09, 0.35, 0.08]], 0.003, M.string)));
    const n1 = deco(at(torus(0.052, 0.006, M.trim), 0.014, 0.548, 0)); n1.rotation.set(Math.PI / 2 - 0.35, 0, 0); fig.add(n1);
    fig.add(deco(curve('mala', [[0.03, 0.56, -0.05], [0.08, 0.49, -0.03], [0.1, 0.46, 0], [0.08, 0.49, 0.03], [0.03, 0.56, 0.05]], 0.005, o.rudraksha ? M.wood : M.pearl)));
    fig.add(deco(at(sphere(0.013, M.ruby), 0.1, 0.455, 0)));
    if (!o.gown && !o.armor && o.head === 'human') fig.add(curve('angav', [[-0.06, 0.57, -0.08], [0.02, 0.56, -0.1], [0.08, 0.46, -0.07], [0.1, 0.36, 0.02], [0.02, 0.26, 0.11]], 0.015, cl2));
    if (o.cape) fig.add(at(mesh(cached('cape2', () => new THREE.CylinderGeometry(0.11, 0.2, 0.52, 24, 1, true, Math.PI * 0.55, Math.PI * 0.9)), o.cape), -0.02, 0.33, 0));
    fig.add(at(cyl(0.028 * bulk, 0.032 * bulk, 0.05, skin), 0, 0.59, 0));        // neck

    // head(s)
    const headY = o.belly ? 0.66 : 0.65;
    const makeHead = (sc) => (o.head === 'monkey' ? monkeyHead(M, o, sc) : o.head === 'bear' ? bearHead(M, o, sc) : humanHead(M, o, sc));
    fig.add(at(makeHead(1), 0.004, headY, 0));
    const crownY = headY + 0.056;
    if (o.crown === 'mukut') fig.add(at(mukut(M, o.crownH || 1), 0, crownY, 0));
    else if (o.crown === 'tiara') fig.add(at(tiara(M), 0, crownY - 0.004, 0));
    else if (o.crown === 'band') { const b = deco(at(torus(0.066, 0.009, M.trim), 0, crownY - 0.012, 0)); b.rotation.x = Math.PI / 2; fig.add(b); fig.add(deco(at(sphere(0.012, M.ruby), 0.066, crownY - 0.012, 0))); }
    else if (o.crown === 'helmet') fig.add(at(lathe('helm', [[0, 0], [0.07, 0], [0.068, 0.04], [0.05, 0.08], [0.02, 0.11], [0, 0.13]], M.trim, 24), 0, crownY - 0.03, 0));
    for (let i = 1; i < (o.heads || 1); i++) {                                  // Ravana's other nine heads
      const side = i % 2 ? 1 : -1, k = Math.ceil(i / 2);
      // the other heads fan out in an arc behind the main one, getting smaller
      const sc = 0.78 - 0.04 * k, zz = side * 0.072 * k, xx = -0.03 * k * k * 0.35;
      const hg = at(makeHead(sc), xx, headY - 0.006 * k, zz);
      hg.rotation.y = -side * 0.18 * k;
      fig.add(hg);
      fig.add(at(mukut(M, 0.5), xx, headY + sc * 0.056 - 0.006 * k, zz));
    }
    if (o.tail) fig.add(curve(o.tail, [[-0.08, 0.26, 0], [-0.19, 0.22, 0.02], [-0.25, 0.36, 0.03], [-0.22, 0.52, 0], [-0.15, 0.6, -0.02]], 0.017, skin));

    // left arm (static): upper arm, forearm, hand + armband and bracelet
    const lsh = [0, 0.535, -0.1 * bulk], lel = [0.035, 0.43, -0.125 * bulk], lwr = [0.08, 0.36, -0.13 * bulk];
    fig.add(limb(lsh, lel, 0.028 * bulk, limbSkin), limb(lel, lwr, 0.023 * bulk, limbSkin), at(sphere(0.025, limbSkin, 1.1, 1, 0.8), lwr[0] + 0.012, lwr[1] - 0.012, lwr[2]));
    const lab = deco(at(torus(0.03 * bulk, 0.006, M.trim), 0.018, 0.485, -0.112 * bulk)); lab.rotation.set(0.3, 0, 0.3); fig.add(lab);
    const lbr = deco(at(torus(0.024 * bulk, 0.005, M.trim), 0.07, 0.375, -0.13 * bulk)); lbr.rotation.set(0.2, 0, 0.9); fig.add(lbr);
    const hand = [lwr[0] + 0.02, lwr[1] - 0.02, lwr[2]];
    if (o.left === 'mountain') fig.add(at(mountain(M), hand[0] + 0.02, hand[1] + 0.01, hand[2] - 0.06));
    else if (o.left === 'lotus') fig.add(at(lotus(M), hand[0], hand[1] - 0.04, hand[2]));
    if (o.quiver) { const q = at(quiver(M), -0.075, 0.47, 0.03); q.rotation.z = 0.45; q.rotation.x = -0.2; fig.add(q); }

    // right arm: pivots at the shoulder and carries the weapon (parts.arm)
    const arm = at(new THREE.Group(), 0, 0.535, 0.1 * bulk);
    arm.add(limb([0, 0, 0], [0.04, -0.1, 0.02], 0.028 * bulk, limbSkin), limb([0.04, -0.1, 0.02], [0.095, -0.13, 0.015], 0.023 * bulk, limbSkin));
    arm.add(at(sphere(0.025, limbSkin, 1.1, 1, 0.8), 0.108, -0.135, 0.015));
    const rab = deco(at(torus(0.03 * bulk, 0.006, M.trim), 0.02, -0.05, 0.012)); rab.rotation.set(-0.3, 0, 0.4); arm.add(rab);
    const w = at(new THREE.Group(), 0.11, -0.14, 0.015);
    const weapon = { bow, gada, club: () => club(M, o.spiked), trident, sword, lotus }[o.weapon] || sword;
    w.add(weapon(M));
    w.rotation.z = -0.25;
    arm.add(w);
    parts.arm = arm;
    fig.add(arm);
    return { root, parts };
  }

  // Maricha, the golden deer (black knight): four legs + a rearing pivot like the horse
  function buildDeer(M) {
    const root = new THREE.Group(), parts = {};
    const pivot = at(new THREE.Group(), -0.18, 0, 0), body = at(new THREE.Group(), 0.18, 0, 0);
    pivot.add(body); root.add(pivot); parts.rear = pivot;
    const hide = M.skin.deer;
    body.add(at(sphere(0.13, hide, 1.6, 0.88, 0.72), 0, 0.5, 0));
    body.add(at(sphere(0.1, hide, 1, 0.95, 0.8), 0.12, 0.52, 0), at(sphere(0.1, hide, 1, 0.95, 0.8), -0.13, 0.51, 0));
    body.add(deco(at(sphere(0.09, M.white, 1.5, 0.5, 0.6), 0, 0.43, 0)));      // pale belly
    for (let i = 0; i < 14; i++) body.add(deco(at(sphere(0.014, M.white), -0.16 + (i % 7) * 0.05, 0.6 - Math.floor(i / 7) * 0.035, (i % 2 ? 1 : -1) * (0.04 + Math.floor(i / 7) * 0.025))));
    body.add(limb([0.16, 0.54, 0], [0.25, 0.78, 0], 0.042, hide));
    body.add(at(sphere(0.052, hide, 1.35, 0.9, 0.85), 0.29, 0.8, 0), at(sphere(0.02, M.iris), 0.36, 0.785, 0));
    for (const z of [-1, 1]) {
      body.add(deco(at(sphere(0.011, M.iris), 0.31, 0.82, z * 0.038)));
      const ear = at(sphere(0.022, hide, 0.4, 1.4, 0.8), 0.27, 0.86, z * 0.04); ear.rotation.x = z * 0.7; body.add(ear);
      body.add(curve('ant' + z, [[0.27, 0.84, z * 0.02], [0.24, 0.95, z * 0.04], [0.29, 1.04, z * 0.06], [0.2, 1.1, z * 0.05]], 0.007, M.trim));
      body.add(deco(curve('antb' + z, [[0.25, 0.95, z * 0.04], [0.19, 0.99, z * 0.07]], 0.005, M.trim)));
    }
    const tail = at(new THREE.Group(), -0.21, 0.55, 0);
    tail.add(at(sphere(0.03, M.white, 1, 1.4, 1), -0.02, 0.02, 0));
    parts.tail = tail; body.add(tail);
    parts.legs = [];
    for (const [x, z] of [[0.13, 0.05], [0.13, -0.05], [-0.13, 0.05], [-0.13, -0.05]]) {
      const leg = at(new THREE.Group(), x, 0.44, z);
      leg.add(limb([0, 0, 0], [0, -0.21, 0], 0.025, hide));
      const knee = at(new THREE.Group(), 0, -0.21, 0);
      knee.add(limb([0, 0, 0], [0, -0.21, 0], 0.016, hide), at(cyl(0.019, 0.021, 0.03, M.hair), 0, -0.225, 0));
      leg.add(knee); leg.userData.knee = knee;
      parts.legs.push(leg); body.add(leg);
    }
    return { root, parts };
  }

  function buildRamayan(type, side, M) {
    const S = M.skin;
    if (side === 'w') switch (type) {
      case 'K': return buildHero(M, { head: 'human', skin: S.ram, cloth: M.cloth1, cloth2: M.cloth2, crown: 'mukut', crownH: 1.15, weapon: 'bow', quiver: true, tilak: true, janeu: true, longHair: true, s: 1.12 });   // Lord Ram
      case 'Q': return buildHero(M, { head: 'human', skin: S.fair, cloth: M.saree, blouse: M.cloth2, gown: true, crown: 'tiara', bindi: true, braid: true, weapon: 'lotus', left: 'lotus', s: 1.02 });   // Sita
      case 'R': return buildHero(M, { head: 'monkey', skin: S.monkey, cloth: M.cloth2, cloth2: M.saree, crown: 'mukut', crownH: 0.8, earrings: true, weapon: 'gada', left: 'mountain', tail: 'hanTail2', janeu: true, muscular: true, s: 1.18 });   // Hanuman
      case 'B': return buildHero(M, { head: 'human', skin: S.fair, cloth: M.cloth2, cloth2: M.cloth1, crown: 'mukut', crownH: 0.8, weapon: 'bow', quiver: true, tilak: true, janeu: true, longHair: true, s: 1.03 });   // Lakshmana
      case 'N': return buildHero(M, { head: 'bear', skin: S.bear, cloth: M.cloth2, cloth2: M.cloth1, crown: 'band', weapon: 'club', rudraksha: true, belly: true, s: 1.0 });   // Jambavan
      default: return buildHero(M, { head: 'monkey', skin: S.monkey, cloth: M.cloth2, cloth2: M.cloth1, crown: 'none', earrings: false, weapon: 'club', tail: 'vanTail2', s: 0.84 });   // Vanara
    }
    switch (type) {
      case 'K': return buildHero(M, { head: 'human', skin: S.ravana, cloth: M.cloth1, cloth2: M.cloth2, crown: 'mukut', crownH: 1.2, heads: 10, mustache: true, armor: true, cape: M.cloth2, weapon: 'sword', s: 1.1 });   // Ravana
      case 'Q': return buildHero(M, { head: 'human', skin: S.fair, cloth: M.saree, blouse: M.cloth2, gown: true, crown: 'tiara', bindi: true, braid: true, weapon: 'lotus', s: 1.02 });   // Mandodari
      case 'R': return buildHero(M, { head: 'human', skin: S.giant, cloth: M.cloth1, cloth2: M.cloth2, crown: 'band', horns: true, tusks: true, wildHair: true, mustache: true, redEye: true, belly: true, weapon: 'club', spiked: true, rudraksha: true, s: 1.26 });   // Kumbhakarna
      case 'B': return buildHero(M, { head: 'human', skin: S.ravana, cloth: M.cloth2, cloth2: M.cloth1, crown: 'helmet', armor: true, cape: M.cloth1, mustache: true, weapon: 'bow', quiver: true, s: 1.04 });   // Indrajit
      case 'N': return buildDeer(M);   // Maricha
      default: return buildHero(M, { head: 'human', skin: S.demon, cloth: M.cloth1, cloth2: M.cloth2, crown: 'none', horns: true, tusks: true, wildHair: true, redEye: true, earrings: false, weapon: 'trident', rudraksha: true, s: 0.84 });   // Rakshasa
    }
  }

  const BUILDERS = { P: buildSoldier, N: buildHorse, B: buildCamel, R: buildElephant, Q: (M) => buildRoyal(M, false), K: (M) => buildRoyal(M, true) };

  function buildPiece(type, side) {
    const ram = style.pieces === 'ramayan';
    if (ram && !MAT.ram) MAT.ram = ramMaterials();
    const M = ram ? MAT.ram[side] : MAT[side];
    const g = new THREE.Group();
    g.add(plinth(M));
    const built = style.pieces === 'classic' ? buildClassic(type, M) : ram ? buildRamayan(type, side, M) : BUILDERS[type](M);
    built.root.position.y = BASE_Y;
    built.root.scale.setScalar(style.pieces === 'classic' ? 1.12 : 1.22);
    g.add(built.root);
    g.userData.parts = built.parts;
    g.userData.figure = built.root;
    return g;
  }

  // which way a piece looks when standing still: towards the other army,
  // turned a little so you see characters side-on
  function restYaw(side) { return side === 'w' ? Math.PI / 6 : Math.PI + Math.PI / 6; }
  function yawTowards(dx, dz) { return Math.atan2(-dz, dx); }

  // ---------- textures ----------
  function canvasTex(w, h, paint, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  function woodGrain(ctx, x, y, w, h, base, dark, light, r, vertical) {
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (let i = 0; i < w * 0.9; i++) {
      const p = r() * (vertical ? w : h);
      ctx.strokeStyle = r() < 0.7 ? dark : light;
      ctx.globalAlpha = 0.05 + r() * 0.12;
      ctx.lineWidth = 0.5 + r() * 2.2;
      ctx.beginPath();
      if (vertical) { ctx.moveTo(x + p, y); ctx.bezierCurveTo(x + p + (r() - 0.5) * 8, y + h * 0.33, x + p + (r() - 0.5) * 8, y + h * 0.66, x + p + (r() - 0.5) * 6, y + h); }
      else { ctx.moveTo(x, y + p); ctx.bezierCurveTo(x + w * 0.33, y + p + (r() - 0.5) * 8, x + w * 0.66, y + p + (r() - 0.5) * 8, x + w, y + p + (r() - 0.5) * 6); }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  function marble(ctx, x, y, w, h, base, vein, r) {
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = vein;
      ctx.globalAlpha = 0.12 + r() * 0.3;
      ctx.lineWidth = 0.6 + r() * 2.5;
      let px = x + r() * w, py = y + r() * h;
      ctx.beginPath(); ctx.moveTo(px, py);
      for (let k = 0; k < 6; k++) { px += (r() - 0.3) * w * 0.35; py += (r() - 0.5) * h * 0.35; ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- scene: table, board, lights ----------
  function buildBoard() {
    if (boardGroup) { scene.remove(boardGroup); }
    boardGroup = new THREE.Group();
    const r = rng(7);
    const wood = style.board === 'wood';
    const S = 128;
    const squaresTex = canvasTex(S * 8, S * 8, (ctx) => {
      for (let rank = 0; rank < 8; rank++) for (let file = 0; file < 8; file++) {
        const light = (file + rank) % 2 === 1;
        const x = file * S, y = (7 - rank) * S;
        if (wood) woodGrain(ctx, x, y, S, S, light ? '#e7c998' : '#6e3f1e', light ? '#a8733c' : '#2a1206', light ? '#fff0d0' : '#9a6038', r, true);
        else marble(ctx, x, y, S, S, light ? '#ece8e0' : '#2f5646', light ? '#8a8f96' : '#b9d8c8', r);
      }
    });
    const top = mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshPhysicalMaterial({ map: squaresTex, roughness: wood ? 0.38 : 0.18, clearcoat: wood ? 0.6 : 0.9, clearcoatRoughness: 0.15 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.002;
    top.castShadow = false;
    boardGroup.add(top);

    // frame with inlay and coordinates
    const F = 1024;
    const frameTex = canvasTex(F, F, (ctx) => {
      if (wood) woodGrain(ctx, 0, 0, F, F, '#4a200d', '#1d0b03', '#8a4a26', r, false);
      else marble(ctx, 0, 0, F, F, '#1b1d20', '#6f757d', r);
      const k = F / 9.4, o = 0.7 * k;
      ctx.strokeStyle = '#e2b755'; ctx.lineWidth = 3;
      ctx.strokeRect(o - 12, o - 12, 8 * k + 24, 8 * k + 24);
      ctx.fillStyle = '#e9c878';
      ctx.font = `600 ${Math.round(k * 0.3)}px Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < 8; i++) {
        ctx.fillText('abcdefgh'[i], o + (i + 0.5) * k, F - o / 2);
        ctx.fillText(String(8 - i), o / 2, o + (i + 0.5) * k);
        ctx.fillText('abcdefgh'[i], o + (i + 0.5) * k, o / 2);
        ctx.fillText(String(8 - i), F - o / 2, o + (i + 0.5) * k);
      }
    });
    const frameMat = new THREE.MeshPhysicalMaterial({ map: frameTex, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    const frame = mesh(new THREE.PlaneGeometry(9.4, 9.4), frameMat);
    frame.rotation.x = -Math.PI / 2;
    frame.position.y = -0.001;
    boardGroup.add(frame);
    const sideMat = new THREE.MeshPhysicalMaterial({ color: wood ? 0x3a1a0a : 0x1b1d20, roughness: 0.4, clearcoat: 0.6 });
    const slab = mesh(new THREE.BoxGeometry(9.4, 0.32, 9.4), sideMat);
    slab.position.y = -0.162;
    boardGroup.add(slab);

    // the table
    const tableTex = canvasTex(1024, 1024, (ctx) => woodGrain(ctx, 0, 0, 1024, 1024, '#2b1a10', '#0e0703', '#5a3a24', rng(3), false), true);
    tableTex.repeat.set(3, 3);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.55 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.322;
    table.receiveShadow = true;
    boardGroup.add(table);
    scene.add(boardGroup);
  }

  function buildLights() {
    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1a10, 0.35));
    const key = new THREE.DirectionalLight(0xfff0dc, 1.9);
    key.position.set(-5, 11, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.55);
    fill.position.set(6, 5, -5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd8a0, 0.6);
    rim.position.set(0, 4, -9);
    scene.add(rim);
  }

  // ---------- highlights ----------
  const HL = {};
  function hlPlane(color, opacity) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1;
    highlightGroup.add(m);
    return m;
  }
  function buildHighlights() {
    highlightGroup = new THREE.Group();
    scene.add(highlightGroup);
    HL.lastFrom = hlPlane(0xffd35a, 0.35); HL.lastTo = hlPlane(0xffd35a, 0.45);
    HL.selected = hlPlane(0x7fe3ff, 0.4);
    HL.check = hlPlane(0xff2a1a, 0.55);
    HL.hintFrom = hlPlane(0x4cff9a, 0.4); HL.hintTo = hlPlane(0x4cff9a, 0.55);
    HL.dots = []; HL.rings = [];
    for (let i = 0; i < 28; i++) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.13, 28), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.4, depthWrite: false }));
      d.rotation.x = -Math.PI / 2; d.visible = false; highlightGroup.add(d); HL.dots.push(d);
      const rg = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.47, 40), new THREE.MeshBasicMaterial({ color: 0xff4a36, transparent: true, opacity: 0.85, depthWrite: false }));
      rg.rotation.x = -Math.PI / 2; rg.visible = false; highlightGroup.add(rg); HL.rings.push(rg);
    }
  }
  function place(m, sq, y) { const p = sqPos(sq); m.position.set(p.x, y || 0.006, p.z); m.visible = true; }
  let hlState = { last: null, selected: -1, targets: [], check: -1, hint: null };
  function applyHighlights() {
    for (const k of ['lastFrom', 'lastTo', 'selected', 'check', 'hintFrom', 'hintTo']) HL[k].visible = false;
    HL.dots.forEach(d => (d.visible = false)); HL.rings.forEach(d => (d.visible = false));
    const h = hlState;
    if (h.last) { place(HL.lastFrom, h.last.from, 0.004); place(HL.lastTo, h.last.to, 0.004); }
    if (h.hint) { place(HL.hintFrom, h.hint.from, 0.006); place(HL.hintTo, h.hint.to, 0.006); }
    if (h.selected >= 0) place(HL.selected, h.selected, 0.007);
    if (h.check >= 0) place(HL.check, h.check, 0.008);
    let di = 0, ri = 0;
    for (const t of h.targets) {
      if (t.capture) { if (HL.rings[ri]) place(HL.rings[ri++], t.sq, 0.01); }
      else if (HL.dots[di]) place(HL.dots[di++], t.sq, 0.01);
    }
  }

  // ---------- pieces on the board ----------
  let vpieces = [];
  function clearPieces() { vpieces.forEach(v => scene.remove(v.group)); vpieces = []; }
  function makeV(type, side, sq) {
    const g = buildPiece(type, side);
    const p = sqPos(sq);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = restYaw(side);
    scene.add(g);
    return { type, side, sq, group: g, x: p.x, z: p.z, y: 0, yaw: restYaw(side), dead: false };
  }
  function setPosition(board) {
    currentBoard = board.slice();
    timeline = null;
    clearFx();
    clearPieces();
    board.forEach((p, sq) => { if (p) vpieces.push(makeV(p.toUpperCase(), E.colorOf(p), sq)); });
  }
  function pieceAt(sq) { return vpieces.find(v => v.sq === sq && !v.dead); }
  function syncV(v) {
    v.group.position.set(v.x, v.y, v.z);
    if (!v.topple) v.group.rotation.set(0, v.yaw, 0);
  }

  // ---------- pose helpers ----------
  function resetPose(v) {
    const P = v.group.userData.parts;
    if (P.legs) P.legs.forEach(l => { l.rotation.z = 0; if (l.userData.knee) l.userData.knee.rotation.z = 0; });
    if (P.arm) P.arm.rotation.z = 0;
    if (P.rear) P.rear.rotation.z = 0;
    if (P.neck) { P.neck.rotation.z = 0; P.neck.position.x = 0.2; }
    if (P.trunk) P.trunk.forEach((j, i) => (j.rotation.z = i === 0 ? 0.35 : 0.12));
    v.group.userData.figure.position.y = BASE_Y;
  }
  function walkPose(v, phase, amp) {
    const P = v.group.userData.parts;
    if (!P.legs) return;
    const big = v.type === 'R' ? 0.25 : v.type === 'P' ? 0.55 : 0.5;
    P.legs.forEach((l, i) => {
      const off = [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5][i] || 0;
      l.rotation.z = Math.sin(phase + off) * big * amp;
      if (l.userData.knee) l.userData.knee.rotation.z = Math.max(0, Math.sin(phase + off + 0.8)) * 0.6 * amp;
    });
    if (P.tail) P.tail.rotation.y = Math.sin(phase * 0.7) * 0.4 * amp;
  }

  // ---------- effects (sparks, dust, slash, glow) ----------
  const fx = [];
  let softTex = null;
  function soft() {
    if (!softTex) softTex = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
    return softTex;
  }
  function clearFx() { fx.forEach(f => fxGroup.remove(f.obj)); fx.length = 0; }
  function spawn(kind, x, y, z, dir) {
    const now = performance.now();
    if (kind === 'spark') {
      for (let i = 0; i < 18; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: 0xffc56a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        s.scale.setScalar(0.08);
        s.position.set(x, y, z);
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2;
        fxGroup.add(s);
        fx.push({ obj: s, t0: now, dur: 450, v: new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e) + 0.4, Math.sin(a) * Math.cos(e)).multiplyScalar(1.6 + Math.random() * 1.4), kind });
      }
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: 0xfff0c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      flash.position.set(x, y, z); flash.scale.setScalar(0.6);
      fxGroup.add(flash);
      fx.push({ obj: flash, t0: now, dur: 250, kind: 'flash' });
    } else if (kind === 'dust') {
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: 0xb9a484, transparent: true, depthWrite: false, opacity: 0.5 }));
        const a = Math.random() * Math.PI * 2;
        s.position.set(x + Math.cos(a) * 0.1, 0.1, z + Math.sin(a) * 0.1);
        s.scale.setScalar(0.25);
        fxGroup.add(s);
        fx.push({ obj: s, t0: now, dur: 900, v: new THREE.Vector3(Math.cos(a) * 0.6, 0.35 + Math.random() * 0.3, Math.sin(a) * 0.6), kind });
      }
    } else if (kind === 'slash') {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.018, 8, 40, Math.PI * 0.9),
        new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      arc.position.set(x, y, z);
      arc.rotation.set(0, dir + Math.PI / 2, 0.6);
      fxGroup.add(arc);
      fx.push({ obj: arc, t0: now, dur: 320, kind });
    } else if (kind === 'burst') {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: 0xffe08a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.position.set(x, 0.5, z);
      fxGroup.add(s);
      fx.push({ obj: s, t0: now, dur: 700, kind });
    }
  }
  function stepFx(now, dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], k = (now - f.t0) / f.dur;
      if (k >= 1) { fxGroup.remove(f.obj); fx.splice(i, 1); continue; }
      if (f.v) { f.obj.position.addScaledVector(f.v, dt); if (f.kind === 'spark') f.v.y -= 4 * dt; }
      if (f.kind === 'spark') f.obj.material.opacity = 1 - k;
      else if (f.kind === 'dust') { f.obj.material.opacity = 0.5 * (1 - k); f.obj.scale.setScalar(0.25 + k * 0.5); }
      else if (f.kind === 'flash') { f.obj.material.opacity = 1 - k; f.obj.scale.setScalar(0.6 + k * 0.8); }
      else if (f.kind === 'slash') { f.obj.material.opacity = 1 - k; f.obj.scale.setScalar(1 + k * 0.3); }
      else if (f.kind === 'burst') { f.obj.material.opacity = 1 - k; f.obj.scale.setScalar(0.5 + k * 2.2); }
    }
  }

  // ---------- camera ----------
  let camTween = null, shakeUntil = 0, shakeAmp = 0;
  function homeCamera(side) {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const d = aspect < 1.25 ? 14.5 + (1.25 - aspect) * 11 : 14.5;
    const s = side === 'b' ? -1 : 1;
    return { pos: new THREE.Vector3(0, d * 0.78, d * 0.62 * s), target: new THREE.Vector3(0, -0.2, 0.35 * s) };
  }
  function moveCamera(to, ms, straight) {
    camTween = { from: camera.position.clone(), fromT: controls.target.clone(), to: to.pos, toT: to.target, t0: performance.now(), ms: ms || 900, straight };
  }
  function stepCamera(now) {
    if (camTween) {
      const k = easeInOut(clamp01((now - camTween.t0) / camTween.ms));
      if (camTween.straight) {
        camera.position.lerpVectors(camTween.from, camTween.to, k);
        controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
        if (k >= 1) camTween = null;
        return;
      }
      // swing round the board rather than cutting through it
      const a0 = Math.atan2(camTween.from.x, camTween.from.z), a1 = Math.atan2(camTween.to.x, camTween.to.z);
      let da = a1 - a0; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      const r0 = Math.hypot(camTween.from.x, camTween.from.z), r1 = Math.hypot(camTween.to.x, camTween.to.z);
      const a = a0 + da * k, rr = lerp(r0, r1, k);
      camera.position.set(Math.sin(a) * rr, lerp(camTween.from.y, camTween.to.y, k), Math.cos(a) * rr);
      controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
      if (k >= 1) camTween = null;
    }
  }

  // ---------- move animation ----------
  let timeline = null;
  let timeScale = 1; // < 1 = slow motion (handy for checking animations)
  function buildTimeline(move, sfx) {
    const tracks = [], events = [];
    const mover = pieceAt(move.from);
    if (!mover) return null;
    const A = sqPos(move.from), B = sqPos(move.to);
    let victimSq = move.captured ? move.to : -1;
    if (move.flag === E.FLAG.EP) victimSq = move.to + (E.colorOf(move.piece) === 'w' ? -8 : 8);
    const victim = victimSq >= 0 ? pieceAt(victimSq) : null;
    const knight = mover.type === 'N';
    const speed = { P: 9, N: 12, B: 8, R: 6, Q: 8, K: 7 };
    const turn = (v, yaw, t0, dur) => {
      let from;
      tracks.push({ t0, t1: t0 + dur, fn: (k) => {
        if (from === undefined) { from = v.yaw; let d = yaw - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; v._dy = d; }
        v.yaw = from + v._dy * easeInOut(k);
      } });
    };
    const walk = (v, a, b, t0, dur, hop) => {
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      turn(v, yawTowards(b.x - a.x, b.z - a.z), t0, 160);
      tracks.push({ t0, t1: t0 + dur, fn: (k) => {
        const e = easeInOut(k);
        v.x = lerp(a.x, b.x, e); v.z = lerp(a.z, b.z, e);
        const ph = k * dur / 1000 * (speed[v.type] || 8);
        v.y = hop ? Math.sin(Math.PI * k) * (0.45 + dist * 0.1) : Math.abs(Math.sin(ph)) * (v.type === 'R' ? 0.015 : 0.03) * (k < 1 ? 1 : 0);
        walkPose(v, ph, k < 1 ? 1 : 0);
        if (hop && v.group.userData.parts.rear) v.group.userData.parts.rear.rotation.z = Math.sin(Math.PI * Math.min(1, k * 1.3)) * 0.35;
      } });
      events.push({ t: t0, fn: () => sfx(hop ? 'leap' : v.type === 'R' ? 'stomp' : 'step') });
    };
    let t = 0;
    if (victim) {
      const V = { x: victim.x, z: victim.z };
      const dx = V.x - A.x, dz = V.z - A.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const stand = { x: V.x - ux * 0.66, z: V.z - uz * 0.66 };
      const approach = 260 + Math.hypot(stand.x - A.x, stand.z - A.z) * 190;
      walk(mover, A, stand, t, approach, knight);
      t += approach;
      turn(victim, yawTowards(-dx, -dz), 0, 300);
      const strike = { P: 460, N: 680, B: 520, R: 700, Q: 560, K: 600 }[mover.type];
      const hitAt = t + strike * 0.6;
      const P = mover.group.userData.parts;
      tracks.push({ t0: t, t1: t + strike, fn: (k) => {
        const up = k < 0.6 ? easeOut(k / 0.6) : 1 - easeInOut((k - 0.6) / 0.4);
        let lunge = Math.sin(Math.PI * clamp01(k / 0.8)) * 0.18;
        if (style.pieces === 'ramayan') {
          if (P.rear) { P.rear.rotation.z = k < 0.55 ? 0.7 * easeOut(k / 0.55) : 0.7 * (1 - easeOut((k - 0.55) / 0.45)); lunge = k > 0.55 ? Math.sin(Math.PI * (k - 0.55) / 0.45) * 0.2 : 0; }
        } else if (style.pieces === 'classic') {
          lunge = k < 0.5 ? -0.1 * easeOut(k / 0.5) : lerp(-0.1, 0.3, easeOut(clamp01((k - 0.5) / 0.15))) * (1 - clamp01((k - 0.65) / 0.35));
        } else if (mover.type === 'P') { P.arm.rotation.z = -1.45 * up; }
        else if (mover.type === 'Q' || mover.type === 'K') { /* sword swing: separate track below */ }
        else if (mover.type === 'N') { P.rear.rotation.z = k < 0.55 ? 0.7 * easeOut(k / 0.55) : 0.7 * (1 - easeOut((k - 0.55) / 0.45)); lunge = k > 0.55 ? Math.sin(Math.PI * (k - 0.55) / 0.45) * 0.2 : 0; }
        else if (mover.type === 'R') {
          P.trunk.forEach((j, i) => (j.rotation.z = lerp(i === 0 ? 0.35 : 0.12, i === 0 ? 1.0 : 0.42, up))); // curls up to trumpet
          lunge = k < 0.35 ? -0.14 * easeOut(k / 0.35) : lerp(-0.14, 0.32, easeOut(clamp01((k - 0.35) / 0.25))) * (1 - clamp01((k - 0.6) / 0.4));
        } else if (mover.type === 'B') { P.neck.rotation.z = -0.5 * up; P.neck.position.x = 0.2 + 0.1 * up; }
        mover.x = stand.x + ux * lunge; mover.z = stand.z + uz * lunge;
      } });
      if ((style.pieces === 'armies' && (mover.type === 'Q' || mover.type === 'K')) || (style.pieces === 'ramayan' && P.arm)) {
        // raise the sword, then bring it down hard
        tracks.push({ t0: t, t1: t + strike, fn: (k) => {
          P.arm.rotation.z = k < 0.45 ? 1.4 * easeOut(k / 0.45) : k < 0.65 ? lerp(1.4, -1.4, easeOut((k - 0.45) / 0.2)) : lerp(-1.4, 0, easeInOut((k - 0.65) / 0.35));
        } });
      }
      const ramSet = style.pieces === 'ramayan';
      events.push({ t: t + strike * 0.15, fn: () => sfx(ramSet ? 'whoosh' : mover.type === 'N' ? 'neigh' : mover.type === 'R' ? 'trumpet' : 'whoosh') });
      events.push({ t: hitAt, fn: () => {
        sfx(mover.type === 'R' ? 'crash' : mover.type === 'N' || mover.type === 'B' ? 'thud' : 'clash');
        spawn('spark', V.x, 0.55, V.z);
        if ('PQK'.includes(mover.type)) spawn('slash', V.x, 0.55, V.z, Math.atan2(-dz, dx));
        shakeUntil = performance.now() + (mover.type === 'R' ? 450 : 200);
        shakeAmp = mover.type === 'R' ? 0.09 : 0.035;
        // the victim gets its own materials so it can flash and fade alone
        victim.group.traverse(o => {
          if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; if (o.material.emissive) o.material.emissive = new THREE.Color(0x000000); }
        });
        victim.topple = { ux, uz };
        victim.ownMaterials = true;
      } });
      const fall = 700;
      tracks.push({ t0: hitAt, t1: hitAt + fall, fn: (k) => {
        const flash = 1 - clamp01(k * 3);
        const fallA = easeInOut(clamp01((k - 0.12) / 0.6)) * 1.45;
        const alpha = 1 - clamp01((k - 0.6) / 0.4);
        const kb = easeOut(k) * 0.3;
        const g = victim.group;
        victim.x = V.x + ux * kb; victim.z = V.z + uz * kb;
        // topple away from the attacker, pivoting on the far edge of the plinth
        const axis = new THREE.Vector3(uz, 0, -ux);
        const q = new THREE.Quaternion().setFromAxisAngle(axis, fallA);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), victim.yaw);
        g.quaternion.copy(q).multiply(qYaw);
        const pivot = new THREE.Vector3(victim.x + ux * 0.36, 0, victim.z + uz * 0.36);
        const off = new THREE.Vector3(victim.x, 0, victim.z).sub(pivot).applyQuaternion(q);
        g.position.copy(pivot).add(off);
        // never touch shared materials - only the victim's own copies
        if (victim.ownMaterials) g.traverse(o => {
          if (!o.isMesh) return;
          o.material.opacity = alpha;
          if (o.material.emissive) o.material.emissive.setRGB(flash * 0.9, flash * 0.15, flash * 0.05);
        });
      } });
      events.push({ t: hitAt + fall * 0.5, fn: () => { spawn('dust', victim.x + ux * 0.5, 0, victim.z + uz * 0.5); sfx('fall'); } });
      events.push({ t: hitAt + fall, fn: () => { victim.dead = true; scene.remove(victim.group); } });
      t = hitAt + fall * 0.45;
      const finish = 280 + Math.hypot(B.x - stand.x, B.z - stand.z) * 180;
      events.push({ t, fn: () => resetPose(mover) });
      walk(mover, stand, B, t, finish, false);
      t += finish;
    } else {
      const dist = Math.hypot(B.x - A.x, B.z - A.z);
      const dur = knight ? 650 : 280 + dist * 190;
      walk(mover, A, B, 0, dur, knight);
      t = dur;
      if (move.flag === E.FLAG.CASTLE_K || move.flag === E.FLAG.CASTLE_Q) {
        const ks = move.flag === E.FLAG.CASTLE_K;
        const rFrom = ks ? move.to + 1 : move.to - 2, rTo = ks ? move.to - 1 : move.to + 1;
        const rook = pieceAt(rFrom);
        if (rook) walk(rook, sqPos(rFrom), sqPos(rTo), 100, dur, false);
      }
    }
    // settle: face the enemy again
    turn(mover, restYaw(mover.side), t, 260);
    events.push({ t, fn: () => { resetPose(mover); mover.y = 0; } });
    if (move.promo) {
      events.push({ t, fn: () => {
        spawn('burst', B.x, 0.5, B.z);
        sfx('promote');
        scene.remove(mover.group);
        const nv = makeV(move.promo.toUpperCase(), mover.side, move.to);
        Object.assign(mover, { type: nv.type, group: nv.group });
      } });
      t += 450;
    }
    return { tracks, events, end: t + 280 };
  }

  function animateMove(move, boardAfter, sfx, done) {
    const tl = buildTimeline(move, sfx || (() => {}));
    if (!tl) { setPosition(boardAfter); if (done) done(); return; }
    timeline = { ...tl, start: performance.now(), boardAfter, done };
  }
  function stepTimeline(now) {
    if (!timeline) return;
    const t = (now - timeline.start) * timeScale;
    // events first, so set-up steps (e.g. giving a victim its own materials) run before tracks use them
    for (const ev of timeline.events) if (!ev.fired && t >= ev.t) { ev.fired = true; ev.fn(); }
    for (const tr of timeline.tracks) {
      if (t < tr.t0 || tr.finished) continue;
      const k = tr.t1 > tr.t0 ? clamp01((t - tr.t0) / (tr.t1 - tr.t0)) : 1;
      tr.fn(k);
      if (k >= 1) tr.finished = true;
    }
    for (const v of vpieces) if (!v.dead && !v.topple) syncV(v);
    if (t >= timeline.end) {
      const { boardAfter, done } = timeline;
      timeline = null;
      // keep the animated objects but make sure squares match the real position
      vpieces = vpieces.filter(v => !v.dead);
      const bySq = new Map();
      boardAfter.forEach((p, sq) => { if (p) bySq.set(sq, p); });
      for (const v of vpieces) {
        let best = null, bd = 9;
        for (const [sq] of bySq) { const p = sqPos(sq), d = Math.hypot(p.x - v.x, p.z - v.z); if (d < bd) { bd = d; best = sq; } }
        v.sq = best;
      }
      const ok = vpieces.length === bySq.size && vpieces.every(v => bySq.get(v.sq) && bySq.get(v.sq).toUpperCase() === v.type && E.colorOf(bySq.get(v.sq)) === v.side);
      if (!ok) setPosition(boardAfter);
      else { currentBoard = boardAfter.slice(); vpieces.forEach(v => { const p = sqPos(v.sq); v.x = p.x; v.z = p.z; v.y = 0; v.yaw = restYaw(v.side); syncV(v); }); }
      if (done) done();
    }
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  function squareAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const nd = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(nd, camera);
    const hits = ray.intersectObjects(vpieces.filter(v => !v.dead).map(v => v.group), true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !vpieces.some(v => v.group === o)) o = o.parent;
      const v = vpieces.find(x => x.group === o);
      if (v) return v.sq;
    }
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return -1;
    const f = Math.floor(p.x + 4), r = Math.floor(4 - p.z);
    return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
  }

  // ---------- small portraits of pieces (captured trays, promotion) ----------
  let iconRenderer = null, iconScene = null, iconCam = null;
  const iconCache = new Map();
  function icon(type, side, px) {
    const key = type + side + style.pieces;
    if (!iconCache.has(key)) {
      if (!iconRenderer) {
        iconRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        iconRenderer.setSize(160, 160);
        iconRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        iconScene = new THREE.Scene();
        iconScene.environment = scene.environment;
        iconScene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 0.8));
        const l = new THREE.DirectionalLight(0xffffff, 2.2); l.position.set(-2, 4, 3); iconScene.add(l);
        iconCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
      }
      const g = buildPiece(type, side);
      g.rotation.y = side === 'w' ? Math.PI / 4 : Math.PI * 0.75;
      iconScene.add(g);
      const h = HEIGHT[type];
      iconCam.position.set(0, h * 0.75 + 0.6, 2.9);
      iconCam.lookAt(0, h * 0.5, 0);
      iconRenderer.render(iconScene, iconCam);
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      c.getContext('2d').drawImage(iconRenderer.domElement, 0, 0);
      iconScene.remove(g);
      iconCache.set(key, c);
    }
    const src = iconCache.get(key);
    const out = document.createElement('canvas');
    const d = Math.min(2, window.devicePixelRatio || 1);
    out.width = out.height = Math.round(px * d);
    out.style.width = out.style.height = px + 'px';
    out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  // ---------- close-ups ----------
  // fly the camera to one piece, keeping the current viewing direction
  function focusSquare(sq) {
    const v = pieceAt(sq);
    if (!v) return null;
    const target = new THREE.Vector3(v.x, 0.6, v.z);
    const dir = camera.position.clone().sub(controls.target);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const pos = target.clone().addScaledVector(dir, 2.4).add(new THREE.Vector3(0, 0.75, 0));
    moveCamera({ pos, target }, 900, true);
    return { type: v.type, side: v.side };
  }
  function setLookMode(on) {
    controls.mouseButtons.LEFT = on ? THREE.MOUSE.ROTATE : null;
    controls.touches.ONE = on ? THREE.TOUCH.ROTATE : null;
  }

  // A turntable to inspect one character up close (spin, drag, zoom).
  function createGallery(cv) {
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x120c08);
    sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    sc.environmentIntensity = 0.6;
    sc.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1a10, 0.5));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.2); key.position.set(3, 5, 4); key.castShadow = true; sc.add(key);
    const rim = new THREE.DirectionalLight(0xffc98a, 1.2); rim.position.set(-3, 3, -4); sc.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    cam.position.set(2.2, 1.4, 2.2);
    const ctl = new OrbitControls(cam, cv);
    ctl.target.set(0, 0.62, 0);
    ctl.enableDamping = true; ctl.enablePan = false;
    ctl.minDistance = 0.7; ctl.maxDistance = 5; ctl.maxPolarAngle = 1.62;
    ctl.autoRotate = true; ctl.autoRotateSpeed = 1.6;
    cv.addEventListener('pointerdown', () => { ctl.autoRotate = false; });
    let piece = null, raf = 0;
    function size() {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    function loop() { raf = requestAnimationFrame(loop); size(); ctl.update(); r.render(sc, cam); }
    return {
      show(type, side) {
        if (piece) sc.remove(piece);
        piece = buildPiece(type, side);
        piece.rotation.y = 0;
        sc.add(piece);
        const h = type === 'K' || type === 'R' ? 0.72 : type === 'P' ? 0.55 : 0.65;
        ctl.target.set(0, h, 0);
        cam.position.set(1.9, h + 0.55, 1.9);
        ctl.autoRotate = true;
      },
      start() { if (!raf) loop(); },
      stop() { cancelAnimationFrame(raf); raf = 0; },
      dispose() { cancelAnimationFrame(raf); raf = 0; ctl.dispose(); r.dispose(); }
    };
  }

  // ---------- public API ----------
  let lastNow = performance.now();
  function init(cv) {
    canvas = cv;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0906);
    scene.fog = new THREE.Fog(0x0d0906, 18, 40);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    MAT = makeMaterials();
    camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 2.2;   // close enough to see faces
    controls.maxDistance = 22;
    controls.maxPolarAngle = 1.45;
    controls.minPolarAngle = 0.12;
    // left button/one finger is for moving pieces; rotate with right-drag or two fingers
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    buildLights();
    buildBoard();
    buildHighlights();
    fxGroup = new THREE.Group();
    scene.add(fxGroup);
    resize();
    const home = homeCamera('w');
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function draw(now) {
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    stepTimeline(now);
    stepFx(now, dt);
    stepCamera(now);
    controls.update();
    // idle life: a gentle breath and a swishing tail
    if (!timeline) for (const v of vpieces) {
      const P = v.group.userData.parts;
      if (P.tail) P.tail.rotation.y = Math.sin(now / 700 + v.x) * 0.25;
    }
    if (hlState.check >= 0) HL.check.material.opacity = 0.35 + 0.25 * Math.sin(now / 160);
    let shake = null;
    if (now < shakeUntil) {
      const k = (shakeUntil - now) / 450;
      shake = new THREE.Vector3((Math.random() - 0.5) * shakeAmp * k, (Math.random() - 0.5) * shakeAmp * k, 0);
      camera.position.add(shake);
    }
    renderer.render(scene, camera);
    if (shake) camera.position.sub(shake);
    return true;
  }

  window.ChessRender = {
    is3D: true,
    init, resize, draw, squareAt, icon, setPosition, animateMove,
    isAnimating: () => !!timeline,
    setHighlights: (h) => { hlState = { ...hlState, ...h }; applyHighlights(); },
    setFlipped: (f) => { if (flipped === f) return; flipped = f; moveCamera(homeCamera(f ? 'b' : 'w'), 1100); },
    resetView: () => moveCamera(homeCamera(flipped ? 'b' : 'w'), 900, true),
    focusSquare, setLookMode, createGallery,
    rotateView: (deg) => {
      const a = Math.atan2(camera.position.x, camera.position.z) + deg * Math.PI / 180;
      const r = Math.hypot(camera.position.x, camera.position.z);
      moveCamera({ pos: new THREE.Vector3(Math.sin(a) * r, camera.position.y, Math.cos(a) * r), target: controls.target.clone() }, 500);
    },
    setStyle: (s) => {
      const changedBoard = s.board && s.board !== style.board;
      style = { ...style, ...s };
      if (changedBoard) buildBoard();
      iconCache.clear();
      if (currentBoard && !timeline) setPosition(currentBoard);
    },
    getStyle: () => ({ ...style }),
    setTimeScale: (k) => { timeScale = k; }
  };
}
