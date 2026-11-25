/* The portrait in the header comes out of noise the way a diffusion model's
   sample does: Gaussian noise at t = T, the photo at t = 0, on the cosine
   schedule x_t = sqrt(ā_t)·x0 + sqrt(1 − ā_t)·ε. The noise is drawn once and
   partly refreshed every step, and the photo under it starts coarse and gains
   detail as t falls, so it sharpens out of the noise rather than fading in.
   Whatever goes wrong, the photo itself ends up showing. */

const N = 192;
const LEVELS = [6, 8, 12, 16, 24, 32, 48, 64, 96, 192];

function gauss(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = 1 - Math.random(), v = Math.random();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

export function mountPortrait(host, { delay = 600, duration = 2800 } = {}) {
  const photo = document.createElement("img");
  photo.src = "cv/portrait.jpg";
  photo.alt = "Mikkel T. Chávez Petersen";
  photo.width = photo.height = 320;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas, photo);

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) return { destroy() { canvas.remove(); photo.remove(); } };

  let raf = 0, timer = 0, alive = true, visible = false, started = false;
  const show = () => {
    photo.style.opacity = "1";
    canvas.style.visibility = "hidden";
  };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { destroy() { canvas.remove(); photo.remove(); } };
  photo.style.opacity = "0";
  photo.style.transition = "opacity 0.25s ease-out";
  photo.addEventListener("error", show);

  /* One pool of Gaussian noise, read at a different offset for each step's
     fresh draw: cheap enough for a phone, and still uncorrelated step to step. */
  const L = N * N * 3;
  const pool = gauss(L + 7919);
  const frame = ctx.createImageData(N, N);
  const px = frame.data;
  const paint = (x0, a, b, eps) => {
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
      px[i] = (a * (x0 ? x0[j] : 0) + b * eps[j] + 1) * 127.5;
      px[i + 1] = (a * (x0 ? x0[j + 1] : 0) + b * eps[j + 1] + 1) * 127.5;
      px[i + 2] = (a * (x0 ? x0[j + 2] : 0) + b * eps[j + 2] + 1) * 127.5;
      px[i + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
  };
  const eps = pool.slice(0, L);
  paint(null, 0, 1, eps);

  const run = () => {
    try {
      /* x0 at each level of detail, scaled back up to N, in [-1, 1]. */
      const scratch = document.createElement("canvas");
      const sctx = scratch.getContext("2d");
      const big = document.createElement("canvas");
      big.width = big.height = N;
      const g = big.getContext("2d", { willReadFrequently: true });
      g.imageSmoothingQuality = "high";
      const levels = LEVELS.map((s) => {
        scratch.width = scratch.height = s;
        sctx.drawImage(photo, 0, 0, s, s);
        g.clearRect(0, 0, N, N);
        g.drawImage(scratch, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const x = new Float32Array(L);
        for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
          x[j] = d[i] / 127.5 - 1; x[j + 1] = d[i + 1] / 127.5 - 1; x[j + 2] = d[i + 2] / 127.5 - 1;
        }
        return x;
      });
      const t0 = performance.now();
      let last = -1;
      const step = () => {
        if (!alive) return;
        try {
          /* Clock read here, not from the frame timestamp, which can be a little
             earlier than t0 and would put p below zero. */
          const p = Math.min(1, Math.max(0, (performance.now() - t0) / duration));
          const k = Math.floor(p * 60);
          if (k !== last) {
            last = k;
            /* Cosine schedule: ā(t) = cos²(π/2 · (t + s) / (1 + s)), t from 1 to 0. */
            const t = 1 - p, s = 0.008;
            const ab = Math.cos((Math.PI / 2) * (t + s) / (1 + s)) ** 2;
            const level = Math.min(levels.length - 1, Math.floor(Math.pow(p, 0.8) * levels.length));
            const off = Math.floor(Math.random() * 7919);
            for (let i = 0; i < L; i++) eps[i] = 0.92 * eps[i] + 0.392 * pool[i + off];
            paint(levels[level], Math.sqrt(ab), Math.sqrt(1 - ab), eps);
          }
          if (p < 1) raf = requestAnimationFrame(step);
          else show();
        } catch (e) {
          show();
        }
      };
      raf = requestAnimationFrame(step);
    } catch (e) {
      show();
    }
  };

  const go = () => {
    if (started || !visible || !photo.complete || !photo.naturalWidth) return;
    started = true;
    timer = setTimeout(run, delay);
  };
  photo.addEventListener("load", go);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; go(); });
  io.observe(host);
  /* A last guard: if it has not finished in time for any reason, show the photo. */
  const guard = setTimeout(() => { if (photo.style.opacity !== "1") show(); }, 15000);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(guard);
      io.disconnect();
      canvas.remove();
      photo.remove();
    },
  };
}
