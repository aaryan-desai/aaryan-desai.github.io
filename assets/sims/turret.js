/* Turret Walker: the Playground sim on the landing page.
   An isometric quadruped with a lead-aiming turret, chasing a drone that follows the pointer.
   Drawn on a canvas from the site's colour tokens; mounts on [data-sim="turret"]. */
(function () {
  'use strict';

  var root = document.querySelector('[data-sim="turret"]');
  if (!root) return;
  function q(sel) { return root.querySelector(sel); }

  var TAU = Math.PI * 2, C30 = Math.cos(Math.PI / 6), S30 = 0.5, DEG = 180 / Math.PI;
  var DT = 1 / 120;

  // geometry, world units = cm. +x is the body's forward axis; on screen +y is the robot's right.
  var HIP_Z = 34, L1 = 36, L2 = 44, LIFT = 14, T_SWING = 0.18;
  var BODY_HL = 30, BODY_HW = 22, BODY_Z0 = 24, BODY_Z1 = 40;
  var TUR_Z0 = 40, TUR_Z1 = 49, BARREL_Z = 45, BARREL = 36;
  var ENEMY_Z = 44, ENEMY_R = 15;
  var LEG_DEFS = [
    { name: 'FL', hx:  22, hy: -18, rx:  46, ry: -44, g: 0 },
    { name: 'FR', hx:  22, hy:  18, rx:  46, ry:  44, g: 1 },
    { name: 'RL', hx: -22, hy: -18, rx: -46, ry: -44, g: 1 },
    { name: 'RR', hx: -22, hy:  18, rx: -46, ry:  44, g: 0 }
  ];

  var P = { droneSpeed: 240, roundSpeed: 560, slew: 5, bodyTurn: 1.6, stepR: 16, standoff: 170 };
  var DEFAULTS = JSON.parse(JSON.stringify(P));
  var SLIDERS = [
    ['droneSpeed', 'Drone speed', 80, 400, 10, function (v) { return (v / 100).toFixed(1) + ' m/s'; },
      'How fast the drone flies when it chases your pointer.'],
    ['roundSpeed', 'Bullet speed', 250, 1000, 10, function (v) { return (v / 100).toFixed(1) + ' m/s'; },
      'How fast each shot travels. Slower bullets make the turret aim further ahead of the drone.'],
    ['slew', 'Turret turn speed', 1, 10, 0.5, function (v) { return Math.round(v * DEG) + '°/s'; },
      'The fastest the gun can swing round. Set it low and the gun falls behind a quick drone.'],
    ['bodyTurn', 'Body turn speed', 0.4, 3, 0.1, function (v) { return Math.round(v * DEG) + '°/s'; },
      'The fastest the robot’s body can rotate to face the drone. The gun turns separately on top.'],
    ['stepR', 'Step distance', 6, 30, 1, function (v) { return v + ' cm'; },
      'How far a foot gets pulled out of place before that leg lifts and steps. Small values mean short, quick steps.'],
    ['standoff', 'Distance to keep', 100, 240, 5, function (v) { return (v / 100).toFixed(2) + ' m'; },
      'How far the robot tries to stay from the drone. It walks closer or backs away to hold this gap.']
  ];

  var A = 300;   // arena half-size, set on resize
  function wrap(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function smooth(k) { return k * k * (3 - 2 * k); }
  function standoff() { return Math.min(P.standoff, A * 0.62); }

  // smallest positive root of a t^2 + b t + c = 0, or null
  function firstHit(a, b, c) {
    if (Math.abs(a) < 1e-6) { var tl = -c / b; return (b !== 0 && tl > 0) ? tl : null; }
    var D = b * b - 4 * a * c;
    if (D < 0) return null;
    var s = Math.sqrt(D), t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
    var lo = Math.min(t1, t2), hi = Math.max(t1, t2);
    return lo > 0 ? lo : hi > 0 ? hi : null;
  }

  // ---------------------------------------------------------------- state

  var S;
  var pointer = { active: false, wx: 0, wy: 0, last: -99, fire: false };

  function reset() {
    S = {
      t: 0, debug: S ? S.debug : false, lead: S ? S.lead : true,
      enemy: { x: 160, y: -110, vx: 0, vy: 0 },
      body: { x: -50, y: 50, vx: 0, vy: 0, yaw: -0.5, yawRate: 0 },
      tur: { yaw: -0.5, rate: 0 },
      aim: { x: 0, y: 0, t: 0, err: 0, range: 0, ok: true },
      legs: [], shots: [], sparks: [], rings: [],
      cooldown: 0, recoil: 0, hits: 0, fired: 0,
      stillFor: 0, lastGroup: 1, thresh: P.stepR
    };
    LEG_DEFS.forEach(function (d) {
      var L = Object.assign({}, d, { x: 0, y: 0, z: 0, swing: false, ph: 0, sx: 0, sy: 0,
        restX: 0, restY: 0, tgtX: 0, tgtY: 0, hipX: 0, hipY: 0, hipZ: HIP_Z, kx: 0, ky: 0, kz: 0, knee: 0, pitch: 0 });
      var w = toWorld(S.body, d.rx, d.ry);
      L.x = w[0]; L.y = w[1];
      S.legs.push(L);
    });
    for (var i = 0; i < 240; i++) update(DT);   // settle so the first frame is mid-action
  }

  function toWorld(b, fx, ly) {
    var c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    return [b.x + fx * c - ly * s, b.y + fx * s + ly * c];
  }

  // ---------------------------------------------------------------- update

  function manual() { return pointer.active && S.t - pointer.last < 3; }

  function update(dt) {
    S.t += dt;
    var e = S.enemy, b = S.body, tu = S.tur, man = manual();

    // drone: chase the pointer (or a Lissajous path) under speed and accel limits
    var tx, ty;
    if (man) { tx = pointer.wx; ty = pointer.wy; }
    else { tx = A * 0.74 * Math.sin(S.t * 0.31); ty = A * 0.74 * Math.sin(S.t * 0.47 + 1.3); }
    var dx = tx - e.x, dy = ty - e.y, d = hyp(dx, dy);
    var sp = Math.min(man ? P.droneSpeed : P.droneSpeed * 0.62, d * 3);
    var ax = (d > 1e-3 ? dx / d * sp : 0) - e.vx, ay = (d > 1e-3 ? dy / d * sp : 0) - e.vy;
    var am = hyp(ax, ay), amax = 900 * dt;
    if (am > amax) { ax *= amax / am; ay *= amax / am; }
    e.vx += ax; e.vy += ay;
    e.x = clamp(e.x + e.vx * dt, -A, A); e.y = clamp(e.y + e.vy * dt, -A, A);

    // body: slow yaw toward the drone, walk along the line of sight to hold range
    var ex = e.x - b.x, ey = e.y - b.y, range = hyp(ex, ey);
    var yawCmd = clamp(wrap(Math.atan2(ey, ex) - b.yaw) * 2.4, -P.bodyTurn, P.bodyTurn);
    b.yawRate += clamp(yawCmd - b.yawRate, -6 * dt, 6 * dt);
    b.yaw = wrap(b.yaw + b.yawRate * dt);
    var rerr = range - standoff();
    var vs = Math.abs(rerr) < 12 ? 0 : clamp(rerr * 0.9, -55, 75);
    var bvx = (range > 1e-3 ? ex / range * vs : 0) - b.vx, bvy = (range > 1e-3 ? ey / range * vs : 0) - b.vy;
    var bm = hyp(bvx, bvy), bmax = 160 * dt;
    if (bm > bmax) { bvx *= bmax / bm; bvy *= bmax / bm; }
    b.vx += bvx; b.vy += bvy;
    var lim = A * 0.8;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (Math.abs(b.x) > lim) { b.x = clamp(b.x, -lim, lim); b.vx = 0; }
    if (Math.abs(b.y) > lim) { b.y = clamp(b.y, -lim, lim); b.vy = 0; }

    // turret: lead solution from the muzzle, slew- and accel-limited yaw loop
    var mx = b.x + Math.cos(tu.yaw) * BARREL, my = b.y + Math.sin(tu.yaw) * BARREL;
    var aimX = e.x, aimY = e.y, lt = hyp(e.x - mx, e.y - my) / P.roundSpeed, ok = true;
    if (S.lead) {
      var qx = e.x - mx, qy = e.y - my;
      var hit = firstHit(e.vx * e.vx + e.vy * e.vy - P.roundSpeed * P.roundSpeed,
                         2 * (qx * e.vx + qy * e.vy), qx * qx + qy * qy);
      if (hit !== null) { lt = hit; aimX = e.x + e.vx * hit; aimY = e.y + e.vy * hit; }
      else ok = false;
    }
    var err = wrap(Math.atan2(aimY - b.y, aimX - b.x) - tu.yaw);
    var wCmd = clamp(err * 10, -P.slew, P.slew);
    tu.rate += clamp(wCmd - tu.rate, -40 * dt, 40 * dt);
    tu.yaw = wrap(tu.yaw + tu.rate * dt);
    S.aim = { x: aimX, y: aimY, t: lt, err: err, range: range, ok: ok };

    // firing: on request, or by itself on autopilot once it is on target
    S.cooldown -= dt;
    S.recoil = Math.max(0, S.recoil - dt * 6);
    if (pointer.fire) { pointer.fire = false; fire(0.16); }
    else if (!man && Math.abs(err) < 0.025 && lt < 1.1) fire(0.7);

    // bullets
    for (var i = S.shots.length - 1; i >= 0; i--) {
      var r = S.shots[i];
      r.x += r.vx * dt; r.y += r.vy * dt; r.life -= dt;
      if (hyp(r.x - e.x, r.y - e.y) < ENEMY_R) { S.shots.splice(i, 1); onHit(); continue; }
      if (r.life <= 0 || Math.abs(r.x) > A * 1.1 || Math.abs(r.y) > A * 1.1) S.shots.splice(i, 1);
    }
    for (i = S.sparks.length - 1; i >= 0; i--) {
      var k = S.sparks[i];
      k.x += k.vx * dt; k.y += k.vy * dt; k.z += k.vz * dt; k.vz -= 420 * dt; k.life -= dt;
      if (k.life <= 0 || k.z < 0) S.sparks.splice(i, 1);
    }
    for (i = S.rings.length - 1; i >= 0; i--) { S.rings[i].life -= dt; if (S.rings[i].life <= 0) S.rings.splice(i, 1); }

    updateLegs(dt);
  }

  function fire(cd) {
    if (S.cooldown > 0) return;
    var b = S.body, c = Math.cos(S.tur.yaw), s = Math.sin(S.tur.yaw);
    S.shots.push({ x: b.x + c * BARREL, y: b.y + s * BARREL, vx: c * P.roundSpeed, vy: s * P.roundSpeed, life: 1.6 });
    S.fired++; S.cooldown = cd; S.recoil = 1;
  }

  function onHit() {
    var e = S.enemy;
    S.hits++;
    S.rings.push({ x: e.x, y: e.y, life: 0.45 });
    for (var i = 0; i < 12; i++) {
      var a = Math.random() * TAU, v = 60 + Math.random() * 140;
      S.sparks.push({ x: e.x, y: e.y, z: ENEMY_Z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 40 + Math.random() * 120, life: 0.5 });
    }
    // respawn on a random edge, away from the robot
    var side = Math.floor(Math.random() * 4), u = (Math.random() * 2 - 1) * A;
    var p = [[A, u], [-A, u], [u, A], [u, -A]][side];
    if (hyp(p[0] - S.body.x, p[1] - S.body.y) < A) { p[0] = -p[0]; p[1] = -p[1]; }
    e.x = p[0]; e.y = p[1]; e.vx = 0; e.vy = 0;
  }

  function updateLegs(dt) {
    var b = S.body, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    var moving = hyp(b.vx, b.vy) > 4 || Math.abs(b.yawRate) > 0.08;
    S.stillFor = moving ? 0 : S.stillFor + dt;
    S.thresh = S.stillFor > 0.5 ? 3 : P.stepR;

    // land the foot ahead of the motion so the stance phase is centred on the rest point
    var lvx = b.vx * 0.22, lvy = b.vy * 0.22, lm = hyp(lvx, lvy), lmax = P.stepR * 0.8;
    if (lm > lmax) { lvx *= lmax / lm; lvy *= lmax / lm; }

    var anySwing = false, worst = [0, 0];
    S.legs.forEach(function (L) {
      L.restX = b.x + L.rx * c - L.ry * s; L.restY = b.y + L.rx * s + L.ry * c;
      L.tgtX = L.restX + lvx; L.tgtY = L.restY + lvy;
      if (L.swing) {
        L.ph += dt / T_SWING;
        if (L.ph >= 1) { L.swing = false; L.x = L.tgtX; L.y = L.tgtY; L.z = 0; }
        else {
          var k = smooth(L.ph);
          L.x = L.sx + (L.tgtX - L.sx) * k; L.y = L.sy + (L.tgtY - L.sy) * k;
          L.z = LIFT * Math.sin(Math.PI * L.ph);
          anySwing = true;
        }
      }
      var dd = hyp(L.x - L.restX, L.y - L.restY);
      if (dd > worst[L.g]) worst[L.g] = dd;
    });

    // trot: one diagonal pair in the air at a time, alternating
    if (!anySwing) {
      var other = 1 - S.lastGroup, g = -1;
      if (worst[other] > S.thresh) g = other;
      else if (worst[S.lastGroup] > S.thresh) g = S.lastGroup;
      if (g >= 0) {
        S.lastGroup = g;
        S.legs.forEach(function (L) { if (L.g === g) { L.swing = true; L.ph = 0; L.sx = L.x; L.sy = L.y; } });
      }
    }

    // 2-bone IK in the vertical plane through hip and foot; knee bends up and outward
    S.legs.forEach(function (L) {
      L.hipX = b.x + L.hx * c - L.hy * s; L.hipY = b.y + L.hx * s + L.hy * c; L.hipZ = HIP_Z;
      var hx = L.x - L.hipX, hy = L.y - L.hipY, r = hyp(hx, hy), dz = L.z - L.hipZ;
      var D = clamp(hyp(r, dz), Math.abs(L1 - L2) + 0.5, L1 + L2 - 0.5);
      var gam = Math.atan2(dz, r);
      var beta = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
      var el = gam + beta, ux = r > 1e-3 ? hx / r : c, uy = r > 1e-3 ? hy / r : s;
      L.kx = L.hipX + ux * L1 * Math.cos(el); L.ky = L.hipY + uy * L1 * Math.cos(el); L.kz = L.hipZ + L1 * Math.sin(el);
      L.knee = Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
      L.pitch = el;
    });
  }

  // ---------------------------------------------------------------- render

  var canvas = q('[data-role="canvas"]'), ctx = canvas.getContext('2d');
  var view = { w: 0, h: 0, dpr: 1, s: 1, ox: 0, oy: 0 };
  var col = {};

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ['surface', 'sunk', 'rule', 'rule-firm', 'ink-soft', 'ink-faint', 'accent', 'accent-wash', 'paper', 'sim-enemy']
      .forEach(function (k) { col[k] = cs.getPropertyValue('--' + k).trim(); });
    if (!running && S) draw();
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = r.width; view.h = r.height;
    canvas.width = Math.round(r.width * view.dpr); canvas.height = Math.round(r.height * view.dpr);
    A = view.w < 560 ? 220 : 300;
    view.s = Math.min(view.w / (4 * A * C30 * 1.04), view.h / ((2 * A + 70) * 1.04));
    view.ox = view.w / 2; view.oy = view.h / 2 + 35 * view.s;
    if (S) {
      S.enemy.x = clamp(S.enemy.x, -A, A); S.enemy.y = clamp(S.enemy.y, -A, A);
      S.body.x = clamp(S.body.x, -A * 0.8, A * 0.8); S.body.y = clamp(S.body.y, -A * 0.8, A * 0.8);
    }
    if (!running && S) draw();
  }

  function P3(x, y, z) { return [view.ox + (x - y) * C30 * view.s, view.oy + ((x + y) * S30 - z) * view.s]; }
  function unproject(px, py, z) {
    var u = (px - view.ox) / view.s, v = (py - view.oy) / view.s + z;
    return { x: (u / C30 + v / S30) / 2, y: (v / S30 - u / C30) / 2 };
  }
  function lw(px) { return Math.max(1, px * Math.min(1.25, view.s * 1.1)); }
  function path(pts, close) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) i ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
  }
  function seg(a, b) { path([P3(a[0], a[1], a[2]), P3(b[0], b[1], b[2])]); ctx.stroke(); }
  function ring(cx, cy, z, r) {
    var pts = [];
    for (var i = 0; i < 40; i++) { var a = i / 40 * TAU; pts.push(P3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); }
    path(pts, true);
  }
  function dot(p, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawBox(cx, cy, yaw, hl, hw, z0, z1, top, side, stroke, w) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var pts = [[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]].map(function (p) {
      return [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c];
    });
    ctx.lineWidth = lw(w); ctx.strokeStyle = stroke; ctx.lineJoin = 'round';
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i + 1) % 4];
      // outward normal of a CCW edge is (dy, -dx); the camera sits toward +x +y
      if ((b[1] - a[1]) - (b[0] - a[0]) > 0) {
        path([P3(a[0], a[1], z0), P3(b[0], b[1], z0), P3(b[0], b[1], z1), P3(a[0], a[1], z1)], true);
        ctx.fillStyle = side; ctx.fill(); ctx.stroke();
      }
    }
    path(pts.map(function (p) { return P3(p[0], p[1], z1); }), true);
    ctx.fillStyle = top; ctx.fill(); ctx.stroke();
  }

  function drawGround() {
    ctx.strokeStyle = col.rule; ctx.lineWidth = 1;
    var n = Math.floor(A / 50);
    for (var i = -n; i <= n; i++) { var v = i * 50; seg([v, -A, 0], [v, A, 0]); seg([-A, v, 0], [A, v, 0]); }
    ctx.strokeStyle = col['rule-firm']; ctx.lineWidth = 1.5;
    path([P3(-A, -A, 0), P3(A, -A, 0), P3(A, A, 0), P3(-A, A, 0)], true); ctx.stroke();
  }

  function drawShadows() {
    var b = S.body, e = S.enemy;
    ctx.globalAlpha = 0.12; ctx.fillStyle = col['ink-soft'];
    var c = Math.cos(b.yaw), s = Math.sin(b.yaw), hl = BODY_HL + 4, hw = BODY_HW + 4;
    path([[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]].map(function (p) {
      return P3(b.x + p[0] * c - p[1] * s, b.y + p[0] * s + p[1] * c, 0);
    }), true);
    ctx.fill();
    S.legs.forEach(function (L) { ring(L.x, L.y, 0, L.swing ? 3 : 5); ctx.fill(); });
    ctx.globalAlpha = 0.2; ctx.fillStyle = col['sim-enemy'];
    ring(e.x, e.y, 0, 11); ctx.fill();
    ctx.globalAlpha = 0.35; ctx.strokeStyle = col['sim-enemy']; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    seg([e.x, e.y, 0], [e.x, e.y, ENEMY_Z - 10]);
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function drawLeg(L) {
    var h = P3(L.hipX, L.hipY, L.hipZ), k = P3(L.kx, L.ky, L.kz), f = P3(L.x, L.y, L.z);
    ctx.strokeStyle = col['ink-soft']; ctx.lineWidth = lw(3); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    path([h, k, f]); ctx.stroke();
    ctx.lineWidth = lw(1.5);
    dot(k, lw(3.4), col.surface, col['ink-soft']);
    dot(h, lw(2.8), col.surface, col['ink-soft']);
    dot(f, lw(2.6), col['ink-soft']);
  }

  function drawRobot() {
    var b = S.body, ty = S.tur.yaw;
    drawBox(b.x, b.y, b.yaw, BODY_HL, BODY_HW, BODY_Z0, BODY_Z1, col.sunk, col.paper, col['ink-soft'], 1.6);
    // headlight on the nose, when the nose faces the camera
    if (Math.cos(b.yaw) + Math.sin(b.yaw) > -0.2) dot(P3(b.x + Math.cos(b.yaw) * BODY_HL, b.y + Math.sin(b.yaw) * BODY_HL, 32), lw(2.6), col.accent);
    var back = Math.cos(ty) + Math.sin(ty) < 0;
    if (back) drawBarrel();
    drawBox(b.x, b.y, ty, 13, 11, TUR_Z0, TUR_Z1, col['accent-wash'], col['accent-wash'], col.accent, 1.6);
    if (!back) drawBarrel();
  }
  function drawBarrel() {
    var b = S.body, c = Math.cos(S.tur.yaw), s = Math.sin(S.tur.yaw), l = BARREL - S.recoil * 7;
    ctx.strokeStyle = col.accent; ctx.lineWidth = lw(4.2); ctx.lineCap = 'round';
    seg([b.x + c * 6, b.y + s * 6, BARREL_Z], [b.x + c * l, b.y + s * l, BARREL_Z]);
  }

  function drawEnemy() {
    var e = S.enemy, z = ENEMY_Z + Math.sin(S.t * 3.1) * 3, spin = S.t * 1.8, r = 12;
    var eq = [0, 1, 2, 3].map(function (i) { var a = spin + i * TAU / 4; return P3(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, z); });
    var top = P3(e.x, e.y, z + 10), bot = P3(e.x, e.y, z - 10);
    // one path, every triangle wound the same way, so the fill covers the union once
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var a = eq[i], b = eq[(i + 1) % 4];
      [top, bot].forEach(function (apex) {
        var cr = (a[0] - apex[0]) * (b[1] - apex[1]) - (a[1] - apex[1]) * (b[0] - apex[0]);
        var p = cr >= 0 ? [apex, a, b] : [apex, b, a];
        ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.closePath();
      });
    }
    ctx.globalAlpha = 0.28; ctx.fillStyle = col['sim-enemy']; ctx.fill('nonzero'); ctx.globalAlpha = 1;
    ctx.strokeStyle = col['sim-enemy']; ctx.lineWidth = lw(1.6); ctx.lineJoin = 'round';
    for (i = 0; i < 4; i++) {
      path([top, eq[i], bot]); ctx.stroke();
      path([eq[i], eq[(i + 1) % 4]]); ctx.stroke();
    }
  }

  function draw() {
    if (!view.w) return;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    drawGround();
    if (S.debug) drawDebugGround();
    drawShadows();

    var items = [], b = S.body, e = S.enemy;
    S.legs.forEach(function (L) { items.push({ k: L.hipX + L.hipY + (L.x + L.y - L.hipX - L.hipY) * 0.3, f: function () { drawLeg(L); } }); });
    items.push({ k: b.x + b.y, f: drawRobot });
    items.push({ k: e.x + e.y, f: drawEnemy });
    S.shots.forEach(function (r) {
      items.push({ k: r.x + r.y, f: function () {
        var sp = hyp(r.vx, r.vy) || 1;
        ctx.strokeStyle = col.accent; ctx.lineWidth = lw(2.6); ctx.lineCap = 'round';
        seg([r.x, r.y, BARREL_Z], [r.x - r.vx / sp * 16, r.y - r.vy / sp * 16, BARREL_Z]);
      } });
    });
    items.sort(function (p, q) { return p.k - q.k; });
    items.forEach(function (it) { it.f(); });

    ctx.strokeStyle = col['sim-enemy']; ctx.lineCap = 'round';
    S.sparks.forEach(function (k) {
      ctx.globalAlpha = clamp(k.life / 0.5, 0, 1); ctx.lineWidth = lw(1.6);
      seg([k.x, k.y, k.z], [k.x - k.vx * 0.04, k.y - k.vy * 0.04, k.z - k.vz * 0.04]);
    });
    S.rings.forEach(function (g) {
      var p = 1 - g.life / 0.45;
      ctx.globalAlpha = 1 - p; ctx.lineWidth = lw(2);
      ring(g.x, g.y, ENEMY_Z, 10 + p * 34); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    if (S.debug) drawDebugTop();
  }

  function label(text, p, color) {
    ctx.font = '500 15px "League Spartan", ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width;
    var x = clamp(p[0], 4, view.w - w - 12), y = clamp(p[1], 12, view.h - 12);
    ctx.globalAlpha = 0.85; ctx.fillStyle = col.surface; ctx.fillRect(x - 4, y - 10, w + 8, 20); ctx.globalAlpha = 1;
    ctx.fillStyle = color; ctx.fillText(text, x, y + 1);
  }

  function drawDebugGround() {
    var b = S.body;
    ctx.lineWidth = 1; ctx.setLineDash([4, 5]); ctx.strokeStyle = col['ink-faint'];
    ring(b.x, b.y, 0, standoff()); ctx.stroke();
    ctx.setLineDash([]);
    S.legs.forEach(function (L) {
      ctx.strokeStyle = col.accent; ctx.globalAlpha = 0.75; ctx.lineWidth = 1;
      ring(L.restX, L.restY, 0, S.thresh); ctx.stroke();
      seg([L.restX, L.restY, 0], [L.x, L.y, 0]);
      var t = P3(L.tgtX, L.tgtY, 0), d = 4;
      path([[t[0] - d, t[1] - d], [t[0] + d, t[1] + d]]); ctx.stroke();
      path([[t[0] - d, t[1] + d], [t[0] + d, t[1] - d]]); ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function drawDebugTop() {
    var b = S.body, e = S.enemy, a = S.aim, tc = Math.cos(S.tur.yaw), ts = Math.sin(S.tur.yaw);
    ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    // IK reach lines: hip straight to foot
    ctx.strokeStyle = col['ink-faint'];
    S.legs.forEach(function (L) { seg([L.hipX, L.hipY, L.hipZ], [L.x, L.y, L.z]); });
    // aim line from the muzzle, and the drone's predicted track to the intercept
    ctx.strokeStyle = col.accent; ctx.lineWidth = 1.2;
    seg([b.x + tc * BARREL, b.y + ts * BARREL, BARREL_Z], [a.x, a.y, ENEMY_Z]);
    ctx.strokeStyle = col['sim-enemy'];
    seg([e.x, e.y, ENEMY_Z], [a.x, a.y, ENEMY_Z]);
    ctx.setLineDash([]);
    var p = P3(a.x, a.y, ENEMY_Z), r = 7;
    ctx.lineWidth = 1.4; dot(p, r, null, col['sim-enemy']);
    path([[p[0] - r - 4, p[1]], [p[0] - r + 3, p[1]]]); ctx.stroke();
    path([[p[0] + r - 3, p[1]], [p[0] + r + 4, p[1]]]); ctx.stroke();
    path([[p[0], p[1] - r - 4], [p[0], p[1] - r + 3]]); ctx.stroke();
    path([[p[0], p[1] + r - 3], [p[0], p[1] + r + 4]]); ctx.stroke();
    label(a.ok ? 'intercept  t = ' + a.t.toFixed(2) + ' s' : 'no intercept: bullet too slow', [p[0] + 14, p[1] - 14], col['sim-enemy']);
    var fl = S.legs[0], kp = P3(fl.kx, fl.ky, fl.kz);
    label('knee ' + Math.round(fl.knee * DEG) + '°', [kp[0] + 10, kp[1] - 12], col['ink-soft']);
    var sp = P3(b.x + standoff() * 0.707, b.y - standoff() * 0.707, 0);
    label('standoff ' + (standoff() / 100).toFixed(2) + ' m', [sp[0] + 6, sp[1]], col['ink-faint']);
  }

  // ---------------------------------------------------------------- telemetry and UI

  function tmEl(k) { return q('[data-tm="' + k + '"]'); }
  var tm = {
    range: tmEl('range'), yaw: tmEl('yaw'), tur: tmEl('tur'), err: tmEl('err'),
    lead: tmEl('lead'), fl: tmEl('fl'), hits: tmEl('hits'), feet: tmEl('feet').children
  };
  var modeEl = q('[data-role="mode"]');
  var lastTm = 0;
  function sgn(v, d) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d); }
  function telemetry() {
    var a = S.aim, fl = S.legs[0];
    tm.range.innerHTML = (a.range / 100).toFixed(2) + ' m <small>hold ' + (standoff() / 100).toFixed(2) + '</small>';
    tm.yaw.textContent = sgn(S.body.yaw * DEG, 1) + '°';
    tm.tur.textContent = sgn(wrap(S.tur.yaw - S.body.yaw) * DEG, 1) + '°';
    tm.err.textContent = sgn(a.err * DEG, 1) + '°';
    tm.lead.innerHTML = a.ok ? a.t.toFixed(2) + ' s' : a.t.toFixed(2) + ' s <small>no lead</small>';
    tm.fl.textContent = Math.round(fl.pitch * DEG) + '° / ' + Math.round(fl.knee * DEG) + '°';
    tm.hits.textContent = S.hits + ' / ' + S.fired;
    for (var i = 0; i < 4; i++) tm.feet[i].classList.toggle('up', S.legs[i].swing);
    var m = manual() ? 'manual' : 'auto';
    if (modeEl.dataset.mode !== m) { modeEl.dataset.mode = m; modeEl.textContent = m === 'manual' ? 'Manual' : 'Autopilot'; }
  }

  // loop: fixed-step physics, render on rAF, paused off-screen and in background tabs
  var running = false, raf = 0, acc = 0, lastT = 0, onScreen = false;
  // with reduced motion the field holds a still frame until the first click, tap or key press on it
  var held = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(now) {
    raf = 0;
    if (!running) return;
    acc += Math.min(0.1, (now - lastT) / 1000); lastT = now;
    while (acc >= DT) { update(DT); acc -= DT; }
    draw();
    if (now - lastTm > 100) { telemetry(); lastTm = now; }
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    var on = onScreen && !document.hidden && !held;
    if (on === running) return;
    running = on;
    if (on) { lastT = performance.now(); acc = 0; raf = requestAnimationFrame(frame); }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function release() { if (held) { held = false; sync(); } }

  // pointer: the drone flies at ENEMY_Z, so un-project at that height to keep it under the cursor.
  // On touch the canvas only takes taps (touch-action: pan-y), so the page still scrolls past it.
  function setPointer(ev) {
    var r = canvas.getBoundingClientRect(), w = unproject(ev.clientX - r.left, ev.clientY - r.top, ENEMY_Z);
    pointer.wx = clamp(w.x, -A, A); pointer.wy = clamp(w.y, -A, A);
    pointer.active = true; pointer.last = S.t;
  }
  canvas.addEventListener('pointermove', setPointer);
  canvas.addEventListener('pointerdown', function (ev) { release(); setPointer(ev); pointer.fire = true; });
  canvas.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') pointer.active = false; });
  canvas.addEventListener('keydown', function (ev) {
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); release(); pointer.fire = true; }
  });

  function toggle(role, key) {
    var el = q('[data-role="' + role + '"]');
    el.setAttribute('aria-pressed', String(S[key]));
    el.addEventListener('click', function () { S[key] = !S[key]; el.setAttribute('aria-pressed', String(S[key])); if (!running) draw(); });
    return el;
  }

  // the site's theme switch sets data-theme on <html>; the system setting applies otherwise
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

  // tuning sliders
  var sliderHost = q('[data-role="sliders"]'), outs = {}, inputs = {};
  SLIDERS.forEach(function (d) {
    var key = d[0], el = document.createElement('div');
    el.className = 'sim-slider';
    el.innerHTML = '<label for="sim-' + key + '"><span>' + d[1] + '</span><output></output></label>' +
      '<input type="range" id="sim-' + key + '" min="' + d[2] + '" max="' + d[3] + '" step="' + d[4] + '" aria-describedby="sim-' + key + '-d">' +
      '<p class="sim-desc" id="sim-' + key + '-d">' + d[6] + '</p>';
    sliderHost.appendChild(el);
    inputs[key] = el.querySelector('input'); outs[key] = el.querySelector('output');
    inputs[key].value = P[key]; outs[key].textContent = d[5](P[key]);
    inputs[key].addEventListener('input', function () {
      P[key] = parseFloat(inputs[key].value); outs[key].textContent = d[5](P[key]);
      if (!running) draw();
    });
  });
  q('[data-role="defaults"]').addEventListener('click', function () {
    SLIDERS.forEach(function (d) { P[d[0]] = DEFAULTS[d[0]]; inputs[d[0]].value = P[d[0]]; outs[d[0]].textContent = d[5](P[d[0]]); });
    if (!running) draw();
  });

  // D toggles the overlay, but only while the sim is on screen and focus is not in a form field
  window.addEventListener('keydown', function (ev) {
    if ((ev.key === 'd' || ev.key === 'D') && onScreen && !ev.metaKey && !ev.ctrlKey && !ev.altKey &&
        !/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) {
      S.debug = !S.debug; debugBtn.setAttribute('aria-pressed', String(S.debug)); if (!running) draw();
    }
  });

  // boot
  readColors();
  resize();
  reset();
  var debugBtn = toggle('debug', 'debug');
  toggle('lead', 'lead');
  q('[data-role="reset"]').addEventListener('click', function () { reset(); if (!running) draw(); telemetry(); });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }).observe(canvas);
  document.addEventListener('visibilitychange', sync);
  draw(); telemetry();
})();
