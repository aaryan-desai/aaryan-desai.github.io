/* Backdrop: the site-wide background, behind every page.
   A drone swarm that flocks, scatters from the cursor and forms a ring when the cursor holds still,
   and a hexapod that walks along the bottom edge to the reader's scroll position.
   The canvas sits at z-index -1, under the see-through .frame sheet. Off for prefers-reduced-motion. */
(function () {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var TAU = Math.PI * 2;
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

  // ---------------------------------------------------------------- tunables

  var WALK = { vmax: 250, k: 4 };          // px/s cap; spring stiffness in 1/s^2, critically damped
  var SW = {
    n: 64,
    neighbour: 60, separation: 20,         // px
    cursorAvoid: 140, walkerAvoid: 70,     // px
    stillToForm: 1.1,                      // s the cursor must hold still before the ring forms
    stillJitter: 6,                        // px of hand jitter still counted as "still"
    breakRadius: 30,                       // px the cursor must move from the ring's centre to break it
    ringMax: 110                           // px
  };

  var cv = document.createElement('canvas');
  cv.className = 'backdrop';
  cv.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(cv, document.body.firstChild);
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, dpr = 1, now = 0, root = document.documentElement;

  var col = {};
  function readColors() {
    var cs = getComputedStyle(root);
    ['surface', 'ink-faint', 'accent', 'head'].forEach(function (k) { col[k] = cs.getPropertyValue('--' + k).trim(); });
  }

  // ---------------------------------------------------------------- cursor

  // The real cursor is used whenever it is over the page. Autopilot takes over only when the pointer leaves
  // the window (or 8 s after the last touch), so holding the mouse still never swaps in the autopilot.
  var mouse = { x: 0, y: 0, inside: false, touch: false, last: -1e9 };
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; mouse.touch = false; mouse.last = now;
  }, { passive: true });
  window.addEventListener('pointerdown', function (e) {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; mouse.touch = e.pointerType === 'touch'; mouse.last = now;
  }, { passive: true });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) mouse.inside = false; });
  window.addEventListener('blur', function () { mouse.inside = false; });
  function live() { return mouse.inside && (!mouse.touch || now - mouse.last < 8); }

  // autopilot: glide to a waypoint, then hold long enough for the ring to form and settle
  var ap = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t: 0, dur: 2, hold: true };
  function apStep(dt) {
    ap.t += dt;
    if (ap.t >= ap.dur) {
      ap.t = 0; ap.hold = !ap.hold;
      if (ap.hold) ap.dur = 4 + Math.random() * 1.5;
      else {
        ap.fx = ap.x; ap.fy = ap.y;
        ap.tx = W * (0.15 + Math.random() * 0.7); ap.ty = H * (0.2 + Math.random() * 0.5);
        ap.dur = 1.6 + Math.random() * 1.2;
      }
    }
    if (!ap.hold) { var k = ease(ap.t / ap.dur); ap.x = ap.fx + (ap.tx - ap.fx) * k; ap.y = ap.fy + (ap.ty - ap.fy) * k; }
  }
  function cursor() { return live() ? { x: mouse.x, y: mouse.y } : { x: ap.x, y: ap.y }; }

  // stillness is measured against a reference point, not frame to frame, so slow drift and jitter are handled
  var still = { x: 0, y: 0, t: 0 };
  function stillStep(dt, c) {
    if (hyp(c.x - still.x, c.y - still.y) > SW.stillJitter) { still.x = c.x; still.y = c.y; still.t = 0; }
    else still.t += dt;
  }

  // ---------------------------------------------------------------- walker

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function ik2(hx, hy, fx, fy, L1, L2) {
    var dx = fx - hx, dy = fy - hy, D = clamp(hyp(dx, dy), Math.abs(L1 - L2) + 0.1, L1 + L2 - 0.1);
    var g = Math.atan2(dy, dx), b = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    return [{ x: hx + Math.cos(g - b) * L1, y: hy + Math.sin(g - b) * L1 }, { x: hx + Math.cos(g + b) * L1, y: hy + Math.sin(g + b) * L1 }];
  }

  var walker = {
    x: null, v: 0, dir: 1, box: { l: 0, r: 0, t: 0, b: 0 },
    step: function (dt) {
      var m = 70, max = Math.max(1, root.scrollHeight - H);
      var tgt = m + clamp(window.scrollY / max, 0, 1) * (W - 2 * m);
      if (this.x === null) this.x = tgt;
      // critically damped spring toward the target, then the speed cap
      var a = WALK.k * (tgt - this.x) - 2 * Math.sqrt(WALK.k) * this.v;
      this.v = clamp(this.v + a * dt, -WALK.vmax, WALK.vmax);
      this.x += this.v * dt;
      if (Math.abs(this.v) > 0.5) this.dir = this.v > 0 ? 1 : -1;
      this.ground = H - 12; this.bodyY = this.ground - 44;
      this.box = { l: this.x - 50, r: this.x + 50, t: this.bodyY - 8, b: this.ground };
    },
    draw: function () {
      var stride = 56, phi = this.x / stride, ground = this.ground, bodyY = this.bodyY, s = stride / 2, lift = 11, L1 = 26, L2 = 32, self = this;
      ctx.strokeStyle = col['ink-faint']; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(W, ground); ctx.stroke();
      // tripod gait: stride phase comes from distance walked, so planted feet never slide
      function legs(side) {
        [-30, 0, 30].forEach(function (off, j) {
          var grp = (j + side) % 2, u = phi + grp * 0.5; u -= Math.floor(u);
          var rel, z;
          if (u < 0.5) { rel = s / 2 - (u / 0.5) * s; z = 0; }
          else { var w = (u - 0.5) / 0.5; rel = -s / 2 + w * s; z = Math.sin(Math.PI * w) * lift; }
          var hx = self.x + off, hy = bodyY + 8, fx = hx + rel + off * 0.35, fy = ground - z;
          var ks = ik2(hx, hy, fx, fy, L1, L2), sg = off === 0 ? self.dir : Math.sign(off);
          var k = (-ks[0].y + sg * (ks[0].x - hx) * 0.6) > (-ks[1].y + sg * (ks[1].x - hx) * 0.6) ? ks[0] : ks[1];
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(k.x, k.y); ctx.lineTo(fx, fy); ctx.stroke();
          circle(k.x, k.y, 2.4); ctx.fillStyle = col.surface; ctx.fill(); ctx.stroke();
        });
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = col.head;
      ctx.globalAlpha = 0.35; ctx.lineWidth = 2.4; legs(1);
      ctx.globalAlpha = 1; ctx.fillStyle = col.surface; ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(this.x - 44, bodyY - 4, 88, 18, 6); else ctx.rect(this.x - 44, bodyY - 4, 88, 18);
      ctx.fill(); ctx.stroke();
      circle(this.x + this.dir * 40, bodyY + 4, 3.2); ctx.fillStyle = col.accent; ctx.fill();
      ctx.lineWidth = 2.8; legs(0);
    }
  };

  // ---------------------------------------------------------------- swarm

  var swarm = {
    a: [], mode: 'flock', anchor: null,
    init: function () {
      this.a = [];
      for (var i = 0; i < SW.n; i++) this.a.push({ x: Math.random() * W, y: Math.random() * H, vx: gauss() * 40, vy: gauss() * 40, slot: 0 });
    },
    ringR: function () { return Math.min(SW.ringMax, Math.min(W, H) * 0.16); },
    step: function (dt, c) {
      var A = this.a, n = A.length, i, j;
      // form after holding still; break only on a real move away from the ring's centre
      if (this.mode === 'flock' && still.t > SW.stillToForm) {
        this.mode = 'form'; this.anchor = { x: still.x, y: still.y };
        var anc = this.anchor;
        // slots in bearing order, so each agent takes the slot roughly in the direction it already is
        A.map(function (a, k) { return { k: k, ang: Math.atan2(a.y - anc.y, a.x - anc.x) }; })
         .sort(function (p, q) { return p.ang - q.ang; })
         .forEach(function (o, k) { A[o.k].slot = k; });
      } else if (this.mode === 'form' && hyp(c.x - this.anchor.x, c.y - this.anchor.y) > SW.breakRadius) {
        this.mode = 'flock'; this.anchor = null;
      }
      var form = this.mode === 'form', R = this.ringR(), wb = walker.box;
      for (i = 0; i < n; i++) {
        var a = A[i], ax = 0, ay = 0, sx = 0, sy = 0, avx = 0, avy = 0, cx = 0, cy = 0, cnt = 0;
        for (j = 0; j < n; j++) {
          if (i === j) continue;
          var b = A[j], ox = b.x - a.x, oy = b.y - a.y, dd = ox * ox + oy * oy;
          if (dd < SW.neighbour * SW.neighbour) {
            cnt++; avx += b.vx; avy += b.vy; cx += ox; cy += oy;
            if (dd < SW.separation * SW.separation) { sx -= ox / (dd + 1) * 400; sy -= oy / (dd + 1) * 400; }
          }
        }
        // separation runs in both modes, so agents never fly through each other on the way to a slot
        ax += sx * (form ? 0.6 : 1); ay += sy * (form ? 0.6 : 1);
        if (form) {
          var ang = a.slot / n * TAU - Math.PI, tx = this.anchor.x + Math.cos(ang) * R, ty = this.anchor.y + Math.sin(ang) * R;
          var dx = tx - a.x, dy = ty - a.y, d = hyp(dx, dy) || 1, want = Math.min(260, d * 3);
          ax += (dx / d * want - a.vx) * 4; ay += (dy / d * want - a.vy) * 4;
        } else {
          if (cnt) { ax += (avx / cnt - a.vx) * 0.9 + cx / cnt * 0.9; ay += (avy / cnt - a.vy) * 0.9 + cy / cnt * 0.9; }
          var mx = a.x - c.x, my = a.y - c.y, md = hyp(mx, my) || 1;
          if (md < SW.cursorAvoid) { ax += mx / md * (SW.cursorAvoid - md) * 9; ay += my / md * (SW.cursorAvoid - md) * 9; }
          ax += gauss() * 30; ay += gauss() * 30;
        }
        // keep clear of the walker in both modes: push away from the nearest point on its box
        var qx = clamp(a.x, wb.l, wb.r), qy = clamp(a.y, wb.t, wb.b), wx = a.x - qx, wy = a.y - qy, wd = hyp(wx, wy);
        if (wd === 0) { wx = a.x - walker.x; wy = a.y - walker.bodyY; wd = hyp(wx, wy) || 1; ax += wx / wd * 900; ay += wy / wd * 900; }
        else if (wd < SW.walkerAvoid) { ax += wx / wd * (SW.walkerAvoid - wd) * 14; ay += wy / wd * (SW.walkerAvoid - wd) * 14; }

        a.vx += ax * dt; a.vy += ay * dt;
        var v = hyp(a.vx, a.vy), vmax = form ? 280 : 150, vmin = form ? 0 : 40;
        if (v > vmax) { a.vx *= vmax / v; a.vy *= vmax / v; } else if (v < vmin && v > 0) { a.vx *= vmin / v; a.vy *= vmin / v; }
        a.x += a.vx * dt; a.y += a.vy * dt;
        if (!form) { if (a.x < -10) a.x += W + 20; if (a.x > W + 10) a.x -= W + 20; if (a.y < -10) a.y += H + 20; if (a.y > H + 10) a.y -= H + 20; }
      }
    },
    draw: function () {
      var A = this.a, i;
      if (this.mode === 'form') {
        ctx.strokeStyle = col['ink-faint']; ctx.globalAlpha = 0.35; ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
        circle(this.anchor.x, this.anchor.y, this.ringR()); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 0.8; ctx.fillStyle = col.head;
      for (i = 0; i < A.length; i++) {
        var p = A[i], h = Math.atan2(p.vy, p.vx), s = 6;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(h) * s, p.y + Math.sin(h) * s);
        ctx.lineTo(p.x + Math.cos(h + 2.5) * s * 0.7, p.y + Math.sin(h + 2.5) * s * 0.7);
        ctx.lineTo(p.x + Math.cos(h - 2.5) * s * 0.7, p.y + Math.sin(h - 2.5) * s * 0.7);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };

  // ---------------------------------------------------------------- loop

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = root.clientWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  var raf = 0, last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000); last = t; now = t / 1000;
    apStep(dt);
    var c = cursor();
    stillStep(dt, c);
    walker.step(dt);
    swarm.step(dt, c);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    walker.draw();
    swarm.draw();
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  // the theme switch sets data-theme on <html>; the system setting applies otherwise
  new MutationObserver(readColors).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', sync);

  readColors();
  resize();
  ap.x = W * 0.5; ap.y = H * 0.45;
  swarm.init();
  sync();
})();
