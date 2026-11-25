
export const TURN = {
  idle: 8,
  onset: 0.08,
  roomWindow: 4,
  voicedHang: 0.15,
  voicedGive: 0.6,
  peekAt: 0.5,
  holdMax: 3,
  holdMin: 1.4,
  waitMax: 6,
  quietMax: 1.8,
  quietMin: 0.8,
  slow: 1.3,
  spread: 0.4,
  longest: 4,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function quantile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
}

function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export function shareDone(span, expected, cfg = TURN) {
  if (!(span > 0) || !(expected > 0)) return 0;
  const z = (Math.log(span / expected) - Math.log(cfg.slow)) / cfg.spread;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function guessSpan(text) {
  const n = String(text || "").split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, n * 0.4);
}

export function speechSpan(analysis) {
  const tr = analysis && analysis.track;
  if (!tr || !tr.speech) return 0;
  let first = -1, last = -1;
  for (let i = 0; i < tr.speech.length; i += 1) if (tr.speech[i]) { if (first < 0) first = i; last = i; }
  return first < 0 ? 0 : (last - first + 1) * tr.hop;
}

export function createTurn(opts = {}) {
  const cfg = { ...TURN, ...(opts.config || {}) };
  const expected = opts.expected > 0 ? opts.expected : 3;
  let model = opts.listens !== false;
  let floor = null, peak = null, start = 0, prev = null;
  const seen = [];
  let burst = null;
  let lastVoiced = null, loudRun = null, noVoicing = false;
  let t0 = null, tl = null;
  let spoken = 0;
  let ev = null;
  let over = null;

  const end = (reason, t) => {
    over = { done: true, reason, spoke: t0 === null ? 0 : tl - t0, quiet: t0 === null ? 0 : t - tl };
    return over;
  };

  return {
    tick(t, db, voiced) {
      if (over) return over;
      if (prev === null) start = t;
      const dt = prev === null ? 0.016 : clamp(t - prev, 0, 0.1);
      prev = t;
      let loud = false;
      if (Number.isFinite(db) && db > -100) {
        seen.push([t, db]);
        while (seen[0][0] < t - cfg.roomWindow) seen.shift();
        peak = peak === null ? db : Math.max(db, peak - dt * 0.5);
        if (seen.length >= 4) {
          floor = quantile(seen.map((r) => r[1]), 0.1);
          loud = db > Math.max(floor + clamp((peak - floor) * 0.25, 9, 14), peak - 40);
        }
      }
      let speech = loud;
      if (voiced !== undefined && !noVoicing) {
        if (loud && voiced) lastVoiced = t;
        loudRun = loud ? (loudRun === null ? t : loudRun) : null;
        if (lastVoiced === null && loudRun !== null && t - loudRun >= cfg.voicedGive) noVoicing = true;
        speech = loud && (noVoicing || (lastVoiced !== null && t - lastVoiced <= cfg.voicedHang));
      }

      if (speech) {
        if (burst === null) burst = t;
        if (t - burst >= (t0 === null ? cfg.onset : 0.04)) {
          if (t0 === null) { t0 = burst; spoken = t - burst; } else spoken += dt;
          tl = t;
        }
      } else burst = null;

      if (t0 === null) return t - start >= cfg.idle ? end("none", t) : { done: false };
      if (t - t0 >= cfg.longest * expected + 4) return end("long", t);
      const q = t - tl;
      const share = shareDone(tl - t0, expected, cfg);
      if (!model) return q >= cfg.quietMin + (cfg.quietMax - cfg.quietMin) * (1 - share) ? end("quiet", t) : { done: false };
      if (q >= cfg.waitMax) return end("quiet", t);
      if (ev && !ev.pending && ev.at === tl) {
        if (ev.said) return end("heard", t);
        if (q >= cfg.holdMin + (cfg.holdMax - cfg.holdMin) * (1 - share)) return end("quiet", t);
      }
      return { done: false };
    },
    wantsPeek() {
      if (over || !model || t0 === null || prev === null) return false;
      return prev - tl >= cfg.peekAt && !(ev && ev.at === tl);
    },
    peeking() {
      ev = { at: tl, pending: true, said: null };
      return tl;
    },
    heard(at, said) {
      if (ev && ev.at === at) { ev.pending = false; ev.said = !!said; }
    },
    listens(on) { model = !!on; },
    state() {
      return { speaking: t0 !== null, t0, tl, spoken, over, asked: !!ev && ev.at === tl, pending: !!ev && ev.at === tl && ev.pending };
    },
  };
}
