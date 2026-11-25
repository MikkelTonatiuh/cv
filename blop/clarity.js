export const MODEL = "Xenova/whisper-tiny.en";
export const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";

export const CUTS = { long: { bad: -5, mid: -2.5 }, short: { bad: -8, mid: -5 } };
const LONG = 4;

const letters = (word) => String(word).replace(/[^A-Za-z]/g, "").length;

export function levelOf(word, s) {
  const c = letters(word) >= LONG ? CUTS.long : CUTS.short;
  return s < c.bad ? "bad" : s < c.mid ? "mid" : "ok";
}

export function creditOf(word, s) {
  const scale = letters(word) >= LONG ? 6 : 10;
  return Math.min(1, Math.max(0, 1 + s / scale));
}

export function wordScores(words, tokens, logps) {
  if (!words.length || tokens.length !== logps.length) return null;
  let cur = -1;
  const group = tokens.map((t) => { if (t.startsWith("Ġ")) cur += 1; return Math.max(cur, 0); });
  if (cur + 1 !== words.length) return null;
  const per = words.map(() => []);
  tokens.forEach((t, k) => { if (/[A-Za-z0-9]/.test(t)) per[group[k]].push(logps[k]); });
  return words.map((w, i) => {
    const s = per[i].length ? per[i].reduce((a, b) => a + b, 0) / per[i].length : 0;
    return { w, s, level: levelOf(w, s) };
  });
}

export const PRAISE = 92;

export function summarize(words, praise = 0) {
  const bad = words.filter((x) => x.level === "bad").sort((a, b) => a.s - b.s);
  const mid = words.filter((x) => x.level === "mid").sort((a, b) => a.s - b.s);
  const weakest = [...words].sort((a, b) => creditOf(a.w, a.s) - creditOf(b.w, b.s)).slice(0, 2);
  const credit = words.reduce((sum, x) => sum + creditOf(x.w, x.s), 0);
  const score = Math.round((100 * credit) / Math.max(1, words.length));
  const band = score < 50 || bad.length >= 0.4 * words.length ? "bad"
    : bad.length === 0 && mid.length <= 1 && score >= praise ? "good"
    : "mid";
  return { score, band, bad, mid, weakest, clear: words.length - bad.length - mid.length, total: words.length };
}

const say = (w) => String(w).replace(/[^A-Za-z']/g, "").toLowerCase();
const quoted = (list) => {
  const q = list.map((x) => "'" + say(x.w) + "'");
  return q.length < 2 ? q[0] : q.slice(0, -1).join(", ") + " and " + q[q.length - 1];
};

export function clarityTips(sum) {
  const { bad, mid } = sum;
  if (sum.band === "bad") return ["a lot of that was hard to make out. listen again and say it a little slower."];
  if (bad.length) {
    const some = bad.slice(0, 3);
    return [quoted(some) + (some.length === 1 ? " was" : " were") + " hard to hear. listen again and try it once more."];
  }
  if (mid.length) {
    const some = mid.slice(0, 2);
    return [(sum.band === "good" ? "that was clear. only " : "nearly. ") + quoted(some) + (some.length === 1 ? " was" : " were") + " a bit soft."];
  }
  if (sum.band === "mid" && sum.weakest.length) {
    return ["nearly. " + quoted(sum.weakest) + (sum.weakest.length === 1 ? " was" : " were") + " the softest."];
  }
  return ["that was clear."];
}

export function clarityNote(sum) {
  return sum.clear + " of " + sum.total + " words " + (sum.total === 1 ? "was" : "were") + " clear";
}

export const TAIL = -2;

export function tailHeard(words) {
  if (!Array.isArray(words) || !words.length) return false;
  const last = words.slice(-2);
  return last.reduce((a, x) => a + x.s, 0) / last.length >= TAIL;
}

export const LIVE = { slowest: 3, lead: 0.3, min: 2, unsaid: -10 };

export function wordsReached(anchors, spoken, cfg = LIVE) {
  if (!Array.isArray(anchors) || !anchors.length || !(spoken > 0)) return 0;
  const t0 = anchors[0][0];
  let k = 0;
  while (k < anchors.length && (anchors[k][1] - t0) * cfg.slowest + cfg.lead <= spoken) k += 1;
  return k;
}

export function downloadMeter() {
  const files = new Map();
  let shown = 0, whole = false;
  return (p) => {
    let pct = null;
    if (p && p.status === "progress_total" && p.total > 5e6) { whole = true; pct = p.progress; }
    else if (p && !whole && p.status === "progress" && p.total > 0) {
      files.set(p.file, [p.loaded, p.total]);
      if ([...files.keys()].some((f) => /\.onnx$/.test(String(f)))) {
        let loaded = 0, total = 0;
        for (const [l, t] of files.values()) { loaded += l; total += t; }
        pct = (100 * loaded) / total;
      }
    }
    if (pct === null || !Number.isFinite(pct)) return null;
    pct = Math.min(99, Math.round(pct));
    if (pct <= shown) return null;
    shown = pct;
    return shown;
  };
}

function assets() {
  const here = typeof location !== "undefined" ? location : null;
  const dev = !!here && /^(localhost|127\.0\.0\.1)$/.test(here.hostname);
  const q = dev ? new URLSearchParams(here.search).get("assets") : null;
  const local = q && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(q) ? q : null;
  return { lib: local ? local + "transformers.min.js" : LIB, local };
}

export function startClarity({ onProgress } = {}) {
  const worker = new Worker(new URL("./clarity.worker.js", import.meta.url), { type: "module" });
  const waiting = new Map();
  let heard = null, nextId = 0;
  const ready = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") { if (onProgress) onProgress(m.pct); }
      else if (m.type === "ready") resolve(true);
      else if (m.type === "scored" && waiting.has(m.id)) { waiting.get(m.id).resolve(m); waiting.delete(m.id); }
      else if (m.type === "heard") { if (heard) heard(m.id, m.text); }
      else if (m.type === "error") {
        const w = waiting.get(m.id);
        if (w) { w.reject(new Error(m.message)); waiting.delete(m.id); } else reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => reject(new Error((e && e.message) || "the word check could not start"));
    worker.postMessage({ type: "init", ...assets() });
  });
  ready.catch(() => undefined);
  return {
    ready,
    score(pcm, text, { heard: hear = true } = {}) {
      const id = (nextId += 1);
      const done = new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        worker.postMessage({ type: "score", id, pcm, text, heard: hear }, [pcm.buffer]);
      }).then((m) => ({ id, words: m.words, ms: m.ms }));
      done.id = id;
      return done;
    },
    hear(id, pcm) { worker.postMessage({ type: "hear", id, pcm }, [pcm.buffer]); },
    cancel(id) { worker.postMessage({ type: "cancel", id }); },
    onHeard(fn) { heard = fn; },
    stop() { worker.terminate(); },
  };
}
