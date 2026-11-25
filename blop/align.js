
import { settle, speechRuns } from "./replay.js";

const SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NMEL = 26, NCEP = 12;

let tables = null;
function setup() {
  if (tables) return tables;
  const hamming = new Float64Array(WIN);
  for (let i = 0; i < WIN; i += 1) hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WIN - 1));
  const mel = (f) => 2595 * Math.log10(1 + f / 700), inv = (m) => 700 * (10 ** (m / 2595) - 1);
  const lo = mel(80), hi = mel(7600);
  const edge = Array.from({ length: NMEL + 2 }, (_, i) => inv(lo + ((hi - lo) * i) / (NMEL + 1)));
  const bin = edge.map((f) => Math.floor(((NFFT + 1) * f) / SR));
  const bank = [];
  for (let m = 1; m <= NMEL; m += 1) {
    const w = new Float64Array(NFFT / 2 + 1);
    for (let k = bin[m - 1]; k < bin[m]; k += 1) w[k] = (k - bin[m - 1]) / Math.max(1, bin[m] - bin[m - 1]);
    for (let k = bin[m]; k <= bin[m + 1]; k += 1) w[k] = (bin[m + 1] - k) / Math.max(1, bin[m + 1] - bin[m]);
    bank.push(w);
  }
  const dct = [];
  for (let c = 1; c <= NCEP; c += 1) dct.push(Float64Array.from({ length: NMEL }, (_, m) => Math.cos((Math.PI * c * (m + 0.5)) / NMEL)));
  const cos = new Float64Array(NFFT / 2), sin = new Float64Array(NFFT / 2);
  for (let i = 0; i < NFFT / 2; i += 1) { cos[i] = Math.cos((-2 * Math.PI * i) / NFFT); sin[i] = Math.sin((-2 * Math.PI * i) / NFFT); }
  tables = { hamming, bank, dct, cos, sin };
  return tables;
}

function fft(re, im, T) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = T.cos[k * step], wi = T.sin[k * step];
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

export function features(pcm, from, to) {
  const T = setup();
  const a = Math.max(0, Math.floor(from * SR)), b = Math.min(pcm.length, Math.ceil(to * SR));
  const n = Math.max(0, Math.floor((b - a - WIN) / HOP) + 1);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), frames = [];
  for (let f = 0; f < n; f += 1) {
    const s = a + f * HOP;
    re.fill(0); im.fill(0);
    for (let i = 0; i < WIN; i += 1) re[i] = (pcm[s + i] - (i ? 0.97 * pcm[s + i - 1] : 0)) * T.hamming[i];
    fft(re, im, T);
    const logmel = new Float64Array(NMEL);
    for (let m = 0; m < NMEL; m += 1) {
      let e = 0;
      const w = T.bank[m];
      for (let k = 0; k <= NFFT / 2; k += 1) if (w[k]) e += w[k] * (re[k] * re[k] + im[k] * im[k]);
      logmel[m] = Math.log(e + 1e-10);
    }
    const v = new Float32Array(NCEP);
    for (let c = 0; c < NCEP; c += 1) { let s2 = 0; for (let m = 0; m < NMEL; m += 1) s2 += T.dct[c][m] * logmel[m]; v[c] = s2; }
    frames.push(v);
  }
  for (let c = 0; c < NCEP; c += 1) {
    let mean = 0;
    for (const v of frames) mean += v[c];
    mean /= Math.max(1, frames.length);
    let varr = 0;
    for (const v of frames) varr += (v[c] - mean) ** 2;
    const sd = Math.sqrt(varr / Math.max(1, frames.length)) || 1;
    for (const v of frames) v[c] = (v[c] - mean) / sd;
  }
  return { frames, from: a / SR };
}

export function warp(ex, take, { band = 0.5, stretch = 0.3 } = {}) {
  const N = ex.length, M = take.length;
  if (!N || !M) return new Array(N).fill(0);
  const line = (k) => (k * (M - 1)) / Math.max(1, N - 1);
  const INF = 1e30, w = Math.max(10, Math.ceil(band * Math.max(N, M)));
  const D = Array.from({ length: N }, () => new Float32Array(M).fill(INF));
  const B = Array.from({ length: N }, () => new Uint8Array(M));
  for (let i = 0; i < N; i += 1) {
    const j0 = Math.max(0, Math.floor(line(i) - w)), j1 = Math.min(M - 1, Math.ceil(line(i) + w));
    for (let j = j0; j <= j1; j += 1) {
      let d = 0;
      const a = ex[i], b = take[j];
      for (let c = 0; c < a.length; c += 1) { const x = a[c] - b[c]; d += x * x; }
      d = Math.sqrt(d);
      if (i === 0 && j === 0) { D[0][0] = d; continue; }
      let best = INF, step = 0;
      if (i > 0 && j > 0 && D[i - 1][j - 1] < best) { best = D[i - 1][j - 1]; step = 0; }
      if (i > 0 && D[i - 1][j] + stretch < best) { best = D[i - 1][j] + stretch; step = 1; }
      if (j > 0 && D[i][j - 1] + stretch < best) { best = D[i][j - 1] + stretch; step = 2; }
      if (best < INF) { D[i][j] = best + d; B[i][j] = step; }
    }
  }
  if (D[N - 1][M - 1] >= INF) return Array.from({ length: N }, (_, k) => line(k));
  const at = Array.from({ length: N }, () => []);
  let i = N - 1, j = M - 1;
  while (i >= 0 && j >= 0) {
    at[i].push(j);
    if (i === 0 && j === 0) break;
    const s = B[i][j];
    if (s === 0) { i -= 1; j -= 1; } else if (s === 1) i -= 1; else j -= 1;
  }
  return at.map((js, k) => (js.length ? js.reduce((x, y) => x + y, 0) / js.length : line(k)));
}
export function carry(spans, ex, take, hop = HOP / SR) {
  const path = warp(ex.frames, take.frames);
  const at = (t) => {
    const i = Math.min(path.length - 1, Math.max(0, Math.round((t - ex.from) / hop)));
    return take.from + path[i] * hop;
  };
  return spans.map(([a, b]) => [at(a), at(b)]);
}

export function exampleSpans(anchors, from, to) {
  const n = anchors.length;
  const a = from === undefined ? Math.max(0, anchors[0][0] - 0.1) : from;
  const b = to === undefined ? anchors[n - 1][1] + 0.1 : to;
  const spans = settle(anchors, a, b);
  if (from !== undefined) spans[0][0] = Math.min(a, spans[0][1]);
  if (to !== undefined) spans[n - 1][1] = Math.max(b, spans[n - 1][0]);
  return spans;
}

export function takeSpans(words, ex, take) {
  const spans = exampleSpans(ex.anchors, ex.run && ex.run.from, ex.run && ex.run.to);
  const exF = ex.feat || features(ex.pcm, Math.max(0, spans[0][0] - 0.05), spans[spans.length - 1][1] + 0.05);
  const { from, to } = speechRuns(take.analysis);
  const tF = features(take.pcm, Math.max(0, from - 0.05), to + 0.05);
  const at = (t) => Math.min(Math.max(t, from), to);
  const out = carry(spans, exF, tF).map((s, i) => ({ w: words[i], from: at(s[0]), to: at(Math.max(s[0], s[1])) }));
  if (ex.run && out.length) { out[0].from = from; out[out.length - 1].to = to; }
  return out;
}
