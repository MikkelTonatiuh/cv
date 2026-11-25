
const N = 192;
const L = N * N * 3;
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

export function mountPortrait(host, { delay = 200, duration = 2800 } = {}) {
  const photo = document.createElement("img");
  photo.alt = "Mikkel T. Chávez Petersen";
  photo.width = photo.height = 320;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas, photo);

  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const steps = calm ? 24 : 60;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    photo.src = "cv/portrait.jpg";
    canvas.remove();
    return { destroy() { photo.remove(); } };
  }

  let raf = 0, idle = 0, timer = 0, guard = 0, alive = true, visible = false, started = false, shown = false;
  photo.style.opacity = "0";
  photo.style.transition = "opacity 0.3s ease-out";
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; go(); });

  const show = () => {
    if (shown) return;
    shown = true;
    cancelAnimationFrame(raf); cancelAnimationFrame(idle);
    clearTimeout(timer); clearTimeout(guard);
    io.disconnect();
    photo.style.opacity = "1";
    setTimeout(() => { canvas.style.visibility = "hidden"; }, 350);
  };
  photo.addEventListener("error", () => {
    show();
    photo.style.display = "none";
    canvas.style.visibility = "hidden";
  });

  const pool = gauss(L + 7919);
  const eps = pool.slice(0, L);
  const frame = ctx.createImageData(N, N);
  const px = frame.data;
  const refresh = () => {
    const off = Math.floor(Math.random() * 7919);
    for (let i = 0; i < L; i++) eps[i] = 0.92 * eps[i] + 0.392 * pool[i + off];
  };
  const paint = (x0, a, b) => {
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
      px[i] = (a * (x0 ? x0[j] : 0) + b * eps[j] + 1) * 127.5;
      px[i + 1] = (a * (x0 ? x0[j + 1] : 0) + b * eps[j + 1] + 1) * 127.5;
      px[i + 2] = (a * (x0 ? x0[j + 2] : 0) + b * eps[j + 2] + 1) * 127.5;
      px[i + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
  };
  paint(null, 0, 1);

  let lastIdle = 0;
  const tick = (now) => {
    if (!alive || started || shown || calm) return;
    if (visible && now - lastIdle > 110) { lastIdle = now; refresh(); paint(null, 0, 1); }
    idle = requestAnimationFrame(tick);
  };
  idle = requestAnimationFrame(tick);

  const run = () => {
    try {
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
      let prev = performance.now(), elapsed = 0, last = -1;
      const step = () => {
        if (!alive || shown) return;
        try {
          const now = performance.now();
          elapsed += Math.min(Math.max(0, now - prev), 64);
          prev = now;
          const p = Math.min(1, elapsed / duration);
          const k = Math.floor(p * steps);
          if (k !== last) {
            last = k;
            const t = 0.9 * (1 - p), s = 0.008;
            const ab = Math.cos((Math.PI / 2) * (t + s) / (1 + s)) ** 2;
            const level = Math.min(levels.length - 1, Math.floor(Math.pow(p, 0.8) * levels.length));
            refresh();
            paint(levels[level], Math.sqrt(ab), Math.sqrt(1 - ab));
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

  function go() {
    if (started || shown || !visible || !photo.complete || !photo.naturalWidth) return;
    started = true;
    cancelAnimationFrame(idle);
    timer = setTimeout(run, delay);
    guard = setTimeout(show, delay + duration * 4 + 2000);
  }
  photo.addEventListener("load", go);
  photo.src = "cv/portrait.jpg";
  io.observe(host);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf); cancelAnimationFrame(idle);
      clearTimeout(timer); clearTimeout(guard);
      io.disconnect();
      canvas.remove();
      photo.remove();
    },
  };
}
