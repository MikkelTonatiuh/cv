
export const VALLEY = {
  sigma: 0.55,
  slope: 16,
  momentum: 0.9,
  maxStep: 0.05,
  depth: 1.35,
  base: 40,
  clearance: 1.9,
  step: 0.5,
  dotLen: 4,
  dotDepth: 400,
  dotSigma: 0.7,
  dotStart: 1.6,
  dotClearance: 3.4,
  maxTurn: 0.55,
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const arcOf = (pts) => { const a = [0]; for (let i = 1; i < pts.length; i++) a.push(a[i - 1] + dist(pts[i], pts[i - 1])); return a; };

export function strokesFromTrack({ pts, pen }) {
  const strokes = [];
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    if (!cur || !pen[i]) { cur = []; strokes.push(cur); }
    cur.push([pts[i][0], pts[i][1]]);
  }
  return strokes;
}

function resample(pts, step) {
  const arc = arcOf(pts), total = arc[arc.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = (k / n) * total;
    while (j < pts.length - 2 && arc[j + 1] < target) j++;
    const seg = arc[j + 1] - arc[j] || 1;
    const t = Math.min(1, Math.max(0, (target - arc[j]) / seg));
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

function smooth(pts, passes) {
  let p = pts;
  const w = [1, 4, 6, 4, 1];
  for (let pass = 0; pass < passes; pass++) {
    const q = p.map((v) => v.slice());
    for (let i = 1; i < p.length - 1; i++) {
      let x = 0, y = 0, ws = 0;
      for (let k = -2; k <= 2; k++) {
        const j = i + k;
        if (j < 0 || j >= p.length) continue;
        x += w[k + 2] * p[j][0]; y += w[k + 2] * p[j][1]; ws += w[k + 2];
      }
      q[i] = [x / ws, y / ws];
    }
    p = q;
  }
  return p;
}

function maxTurn(pts) {
  let m = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > m) m = d;
  }
  return m;
}

function shapeFloor(raw, P) {
  let pts = resample(raw, P.step);
  if (pts.length < 4) return pts;
  pts = smooth(pts, 3);
  for (let guard = 0; guard < 24 && maxTurn(pts) > P.maxTurn; guard++) pts = resample(smooth(pts, 2), P.step);
  return resample(pts, P.step);
}

export function shapeStrokes(strokes, opts = {}) {
  const P = { ...VALLEY, ...opts };
  const items = [];
  for (const raw of strokes) {
    const len = arcOf(raw)[raw.length - 1];
    if (len < P.dotLen) {
      let x = 0, y = 0;
      for (const p of raw) { x += p[0]; y += p[1]; }
      items.push({ kind: "dot", at: [x / raw.length, y / raw.length] });
    } else {
      items.push({ kind: "stroke", floor: shapeFloor(raw, P) });
    }
  }

  const clear = (k, idx, floor) => {
    const p = floor[idx];
    const arc = floor.arcs || (floor.arcs = arcOf(floor));
    let best = Infinity;
    for (let j = 0; j < items.length; j++) {
      const o = items[j];
      if (o.kind === "dot") { best = Math.min(best, dist(p, o.at)); continue; }
      const f = o.floor;
      for (let i = 0; i < f.length; i++) {
        if (j === k && Math.abs(arc[i] - arc[idx]) < 8) continue;
        const d = dist(p, f[i]);
        if (d < best) best = d;
      }
    }
    return best;
  };
  items.forEach((it, k) => {
    if (it.kind !== "stroke") return;
    let f = it.floor;
    for (const end of ["tail", "head"]) {
      for (let guard = 0; guard < 40 && f.length > 8; guard++) {
        f.arcs = null;
        const idx = end === "tail" ? f.length - 1 : 0;
        if (clear(k, idx, f) >= P.clearance) break;
        f = end === "tail" ? f.slice(0, -1) : f.slice(1);
        it.floor = f;
      }
    }
    f.arcs = null;
  });

  const floorsNear = (x, y) => {
    let best = Infinity;
    for (const o of items) if (o.kind === "stroke") for (const q of o.floor) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < best) best = d; }
    return best;
  };
  for (const it of items) {
    if (it.kind !== "dot") continue;
    if (floorsNear(it.at[0], it.at[1]) < P.dotClearance) { it.kind = "skip"; continue; }
    let bestDir = null, bestClear = -1;
    for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
      const c = floorsNear(it.at[0] + dx * P.dotStart, it.at[1] + dy * P.dotStart);
      if (c > bestClear) { bestClear = c; bestDir = [dx, dy]; }
    }
    it.start = [it.at[0] + bestDir[0] * P.dotStart, it.at[1] + bestDir[1] * P.dotStart];
  }
  return items;
}

export function fitToTerrain(items, terrainGrad, { slopeFactor = 3, pitFactor = 14 } = {}) {
  let steepest = 0;
  for (const it of items) {
    const pts = it.kind === "stroke" ? it.floor : it.kind === "dot" ? [it.start, it.at] : [];
    for (const p of pts) {
      const g = terrainGrad(p[0], p[1]);
      const m = Math.hypot(g[0], g[1]);
      if (m > steepest) steepest = m;
    }
  }
  return { slope: Math.max(VALLEY.slope, Math.ceil(slopeFactor * steepest)), dotDepth: Math.max(VALLEY.dotDepth, Math.ceil(pitFactor * steepest)) };
}

export function buildValleys(items, opts = {}) {
  const P = { ...VALLEY, ...opts };
  const s2 = P.sigma * P.sigma;
  const reach = 5 * P.sigma, cell = Math.max(3, reach * 1.2);
  const seg = { ax: [], ay: [], tx: [], ty: [], len: [], s0: [], owner: [], last: [] };
  const owners = [];
  items.forEach((it, k) => {
    if (it.kind === "skip") { owners.push({ kind: "skip" }); return; }
    if (it.kind === "dot") { owners.push({ kind: "dot", at: it.at }); return; }
    const f = it.floor, arc = arcOf(f), S = arc[arc.length - 1];
    owners.push({ kind: "stroke", S, D: P.depth * P.slope * S + P.base, floor: f, arc });
    for (let i = 0; i < f.length - 1; i++) {
      const len = arc[i + 1] - arc[i];
      if (len < 1e-9) continue;
      seg.ax.push(f[i][0]); seg.ay.push(f[i][1]);
      seg.tx.push((f[i + 1][0] - f[i][0]) / len); seg.ty.push((f[i + 1][1] - f[i][1]) / len);
      seg.len.push(len); seg.s0.push(arc[i]); seg.owner.push(k); seg.last.push(i === f.length - 2);
    }
  });
  const nSeg = seg.len.length;

  const hash = new Map();
  const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  const file = (cx, cy, v) => { const kk = key(cx, cy); let a = hash.get(kk); if (!a) hash.set(kk, (a = [])); a.push(v); };
  for (let i = 0; i < nSeg; i++) {
    const bx = seg.ax[i] + seg.tx[i] * seg.len[i], by = seg.ay[i] + seg.ty[i] * seg.len[i];
    const x0 = Math.floor((Math.min(seg.ax[i], bx) - reach) / cell), x1 = Math.floor((Math.max(seg.ax[i], bx) + reach) / cell);
    const y0 = Math.floor((Math.min(seg.ay[i], by) - reach) / cell), y1 = Math.floor((Math.max(seg.ay[i], by) + reach) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) file(cx, cy, i);
  }
  owners.forEach((o, k) => {
    if (o.kind !== "dot") return;
    const x0 = Math.floor((o.at[0] - reach) / cell), x1 = Math.floor((o.at[0] + reach) / cell);
    const y0 = Math.floor((o.at[1] - reach) / cell), y1 = Math.floor((o.at[1] + reach) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) file(cx, cy, -1 - k);
  });

  const out = { value: 0, gx: 0, gy: 0, owner: -1, s: 0 };
  const SLOTS = 8;
  const sk = new Int32Array(SLOTS), sD2 = new Float64Array(SLOTS), sS = new Float64Array(SLOTS);
  const sEx = new Float64Array(SLOTS), sEy = new Float64Array(SLOTS), sTx = new Float64Array(SLOTS), sTy = new Float64Array(SLOTS);
  const sIn = new Uint8Array(SLOTS);
  function at(px, py) {
    let best = 0, gx = 0, gy = 0, who = -1, sBest = 0, used = 0;
    const list = hash.get(key(Math.floor(px / cell), Math.floor(py / cell)));
    if (list) {
      for (let n = 0; n < list.length; n++) {
        const i = list[n];
        if (i < 0) {
          const o = owners[-1 - i], dx = px - o.at[0], dy = py - o.at[1], r2 = dx * dx + dy * dy;
          const ds2 = P.dotSigma * P.dotSigma, e = Math.exp(-r2 / (2 * ds2)), v = -P.dotDepth * e;
          if (v < best) { best = v; who = -1 - i; sBest = 0; const g = (P.dotDepth * e) / ds2; gx = g * dx; gy = g * dy; }
          continue;
        }
        const dx = px - seg.ax[i], dy = py - seg.ay[i];
        let t = dx * seg.tx[i] + dy * seg.ty[i];
        const ahead = t > seg.len[i] && !seg.last[i];
        const interior = t >= 0 && (t <= seg.len[i] || ahead);
        const tu = t;
        if (t < 0) t = 0; else if (t > seg.len[i]) t = seg.len[i];
        const ex = px - (seg.ax[i] + seg.tx[i] * t), ey = py - (seg.ay[i] + seg.ty[i] * t), d2 = ex * ex + ey * ey;
        if (d2 > reach * reach) continue;
        const sAlong = ahead ? tu : t;
        const k = seg.owner[i];
        let j = 0;
        while (j < used && sk[j] !== k) j++;
        if (j === used) { if (used === SLOTS) continue; used++; sk[j] = k; sD2[j] = Infinity; sIn[j] = 0; }
        if (d2 < sD2[j] - 1e-12 || (d2 <= sD2[j] + 1e-12 && interior && !sIn[j])) {
          sD2[j] = d2; sS[j] = seg.s0[i] + sAlong; sEx[j] = ex; sEy[j] = ey; sTx[j] = seg.tx[i]; sTy[j] = seg.ty[i]; sIn[j] = interior ? 1 : 0;
        }
      }
      for (let j = 0; j < used; j++) {
        const o = owners[sk[j]], e = Math.exp(-sD2[j] / (2 * s2));
        const v = o.D * (1 - e) + P.slope * (o.S - sS[j]) - o.D;
        if (v >= best) continue;
        best = v; who = sk[j]; sBest = sS[j];
        const wp = (o.D * e) / s2;
        gx = wp * sEx[j]; gy = wp * sEy[j];
        if (sIn[j]) { gx -= P.slope * sTx[j]; gy -= P.slope * sTy[j]; }
      }
    }
    out.value = best; out.gx = gx; out.gy = gy; out.owner = who; out.s = sBest;
    return out;
  }
  return { at, items, owners, params: P, strokes: owners.filter((o) => o.kind === "stroke").length };
}

export function writeName(valleys, terrainGrad, { keep = 0.45, gradientOn = true, momentum = valleys.params.momentum } = {}) {
  const P = valleys.params;
  const runs = [];
  valleys.items.forEach((it, k) => {
    const o = valleys.owners[k];
    if (it.kind === "skip") { runs.push({ item: k, kind: "skip", start: null, end: null, path: [], steps: 0, derailed: false, finished: true }); return; }
    const mu = it.kind === "dot" ? 0 : momentum;
    let p, lr, done;
    if (it.kind === "dot") {
      p = it.start.slice();
      lr = 0.8 * P.dotSigma * P.dotSigma / P.dotDepth;
      done = (v, gx, gy) => Math.hypot(gx, gy) * lr < 2e-4;
    } else {
      p = o.floor[0].slice();
      lr = Math.min(0.8 * (1 + mu) * P.sigma * P.sigma / o.D, P.maxStep * (1 - mu) / P.slope);
      const margin = 3 * lr * P.slope / (1 - mu);
      done = (v) => v.owner === k && v.s >= o.S - margin;
    }
    const start = p.slice();
    const path = [p.slice()];
    let last = p.slice(), steps = 0, off = 0, arrived = false, settle = 0, vx = 0, vy = 0;
    const settleFor = mu ? 150 : 24;
    const cap = it.kind === "dot" ? 600 : 4 * (o.S / (lr * P.slope / (1 - mu))) + 2000;
    while (steps < cap) {
      const v = valleys.at(p[0], p[1]);
      let gx = gradientOn ? v.gx : 0, gy = gradientOn ? v.gy : 0;
      if (terrainGrad) { const g = terrainGrad(p[0], p[1]); gx += g[0]; gy += g[1]; }
      if (it.kind === "stroke") {
        if (v.owner !== k) { if (++off > 60) break; } else off = 0;
      }
      if (arrived || done(v, gx, gy)) { arrived = true; if (++settle > settleFor) break; }
      vx = mu * vx - lr * gx; vy = mu * vy - lr * gy;
      p[0] += vx; p[1] += vy;
      steps++;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= keep) { path.push([p[0], p[1]]); last = [p[0], p[1]]; }
    }
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) path.push([p[0], p[1]]);
    runs.push({ item: k, kind: it.kind, start, end: [p[0], p[1]], path, steps, derailed: it.kind === "stroke" && off > 60, finished: arrived });
  });
  return runs;
}
