import { floorAt, rasterName, buildField, contours, ringsAround, nameTrack, descend, pieces, pathData, bounds, svgEl, peakIn, NAME } from "./field.js";

function offsetIn(el, container) {
  let x = 0, y = 0;
  for (let n = el; n && n !== container; n = n.offsetParent) {
    x += n.offsetLeft;
    y += n.offsetTop;
    if (!n.offsetParent || n.offsetParent === container) break;
  }
  return [x, y];
}

export function mountScene({ fieldSvg, nameHost, mathHost, fontPx = 50, replayMs = 26000 }) {
  let anims = [];
  let timer = 0, resizeTimer = 0;
  let parts = [], dots = [], notes = [], rings = [], leader = null, bloom = null, totalLen = 0, slowLen = 0;
  let sheen = null, sheenRaf = 0, markStride = 1;
  let builtKey = "";
  let recheckDepth = 0, recheckTimer = 0;
  const r1 = (n) => Math.round(n * 10) / 10;

  const contentHeight = (container) => {
    const cTop = container.getBoundingClientRect().top;
    let h = 0;
    for (const el of container.children) {
      if (el === fieldSvg) continue;
      const r = el.getBoundingClientRect();
      if (r.height) h = Math.max(h, r.bottom - cTop);
    }
    return Math.max(320, Math.round(h), container.clientHeight, window.innerHeight);
  };

  const build = () => {
    const container = fieldSvg.parentElement;
    const docW = Math.max(320, container.clientWidth);
    const docH = contentHeight(container);
    const [nameX, nameY] = offsetIn(nameHost, container);
    const margin = 16;
    const avail = Math.max(120, docW - nameX - margin);
    let raster = rasterName(fontPx);
    if (raster.cssW > avail) {
      raster = rasterName(Math.max(17, fontPx * (avail / raster.cssW)));
    }

    const field = buildField({ docW, docH, raster, nameX, nameY, cell: 4 });
    builtKey = [nameX, nameY, nameHost.offsetWidth, docW, docH].join("|");
    const track = nameTrack(raster, nameX, nameY);
    const bandTop = 8;
    const bandBottom = nameY + raster.cssH * 0.72;
    let startX = Math.min(docW - 18, nameX + avail - 6);
    let startY = floorAt(field, startX, bandTop, bandBottom);
    for (let k = 0; k < 26; k++) {
      const y = floorAt(field, startX, bandTop, bandBottom);
      if (field.grad(startX, y)[0] > 0.35) { startY = y; break; }
      startX -= 8;
      startY = y;
    }
    const peak = peakIn(field, 16, nameX + raster.cssW * 0.55, bandTop, bandBottom);
    const run = descend(field, track, {
      docW, docH, bandTop, bandBottom,
      start: [startX, startY],
      entry: [-4, 0],
      vmax: 34,
    });
    const { list, total } = pieces(run);
    totalLen = total;

    fieldSvg.setAttribute("viewBox", `0 0 ${Math.round(docW)} ${Math.round(docH)}`);
    fieldSvg.setAttribute("preserveAspectRatio", "none");
    fieldSvg.style.height = `${Math.round(docH)}px`;
    const frag = document.createDocumentFragment();
    rings = [];
    const epi = run.pts[run.pts.length - 1];
    ringsAround(contours(field), epi[0], epi[1]).forEach((r) => {
      if (!r.d) return;
      const el = svgEl("path", {
        d: r.d,
        fill: "none",
        stroke: "var(--line, #E6E2D8)",
        "stroke-width": r.idx ? "0.85" : "0.6",
        "stroke-linecap": "round",
        opacity: r.idx ? "0.2" : "0.075",
      });
      el.dataset.idx = r.idx ? "1" : "";
      frag.appendChild(el);
      rings.push(el);
    });
    fieldSvg.replaceChildren(frag);

    const bb = bounds(run.pts);
    const pad = 8;
    const svg = svgEl("svg", {
      viewBox: `${bb.x0 - pad} ${bb.y0 - pad} ${bb.w + pad * 2} ${bb.h + pad * 2}`,
      role: "img",
      "aria-label": NAME,
    });
    svg.appendChild(svgEl("title", {})).textContent = NAME;
    svg.style.position = "absolute";
    svg.style.left = `${bb.x0 - pad - nameX}px`;
    svg.style.top = `${bb.y0 - pad - nameY}px`;
    svg.style.width = `${bb.w + pad * 2}px`;
    svg.style.height = `${bb.h + pad * 2}px`;
    svg.style.overflow = "visible";
    svg.style.cursor = "pointer";

    const defs = svgEl("defs", {});
    svg.appendChild(defs);

    parts = list.map((piece) => {
      const len = Math.max(1, Math.round(piece.len));
      const travel = piece.mode === "travel";
      const stepping = piece.mode === "run";
      const el = svgEl("path", {
        d: pathData(piece.pts),
        fill: "none",
        stroke: "var(--line, #E6E2D8)",
        "stroke-width": travel ? "0.9" : stepping ? "0.7" : "1.7",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: travel ? "0.2" : stepping ? "0.45" : "1",
        "stroke-dasharray": `${len} ${len}`,
        "stroke-dashoffset": String(len),
      });
      svg.appendChild(el);
      return { el, len, start: piece.start, mode: piece.mode, i0: piece.i0, pts: piece.pts, dash: `${len} ${len}`, opacity: travel ? 0.2 : stepping ? 0.45 : 1 };
    });

    slowLen = (list.find((p) => p.mode !== "run") || { start: total }).start || total;

    dots = [];
    let acc = 0;
    const it = run.iterates || [];
    const stride = it.length >= 8 ? 2 : 1;
    markStride = stride;
    const minGap = it.length >= 8 ? 5.5 : 3.5;
    let lastMark = null;
    for (let i = 1; i < it.length; i++) {
      acc += Math.hypot(it[i][0] - it[i - 1][0], it[i][1] - it[i - 1][1]);
      if (i % stride) continue;
      if (lastMark && Math.hypot(it[i][0] - lastMark[0], it[i][1] - lastMark[1]) < minGap) continue;
      lastMark = it[i];
      const c = svgEl("circle", {
        cx: String(Math.round(it[i][0] * 10) / 10),
        cy: String(Math.round(it[i][1] * 10) / 10),
        r: "2.2",
        fill: "var(--line, #E6E2D8)",
        opacity: "0.95",
      });
      svg.appendChild(c);
      dots.push({ el: c, start: acc });
    }

    leader = svgEl("path", {
      d: pathData(run.pts), fill: "none", stroke: "var(--run, #ffffff)", "stroke-width": "2.6",
      "stroke-linecap": "round", "stroke-linejoin": "round",
      "stroke-dasharray": `18 ${Math.round(total) * 2}`, "stroke-dashoffset": "18", opacity: "0",
    });

    notes = [];

    const MATH = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
    const mathText = (x, y, str, size, fill, extra) => {
      const t = svgEl("text", Object.assign({
        x: String(r1(x)), y: String(r1(y)),
        fill, "font-size": String(size), "font-style": "italic",
        "font-family": MATH, "letter-spacing": "0.015em", opacity: "0",
      }, extra || {}));
      t.textContent = str;
      svg.appendChild(t);
      return t;
    };

    const gr = run.grads || [];
    const st = markStride || 1;
    const ctl = document.querySelector("[data-controls]");
    let navFloor = 6;
    if (ctl) {
      const cb = ctl.getBoundingClientRect();
      if (cb.height) navFloor = Math.max(navFloor, cb.bottom + window.scrollY + 8);
    }
    const armY = (i) => {
      if (!it[i] || !it[i + st]) return -Infinity;
      return Math.min(it[i][1], it[i + st][1]);
    };
    let vis = -1;
    for (let i = st; i + st * 3 < it.length; i += st) {
      if (armY(i) >= navFloor && armY(i + st) >= navFloor && armY(i + st * 2) >= navFloor) { vis = i; break; }
    }
    if (vis < 0) {
      vis = Math.max(st, it.findIndex((p) => p[1] >= navFloor));
      vis -= vis % st;
    }
    let nAcc = 0;
    const marks = [];
    for (let i = 0; i < it.length - 1; i++) {
      if (i > 0) nAcc += Math.hypot(it[i][0] - it[i - 1][0], it[i][1] - it[i - 1][1]);
      if (i < vis || i >= vis + st * 3 || (i - vis) % st) continue;
      const g = gr[i];
      const nxt = it[i + st] || it[it.length - 1];
      const dx = nxt[0] - it[i][0], dy = nxt[1] - it[i][1];
      const step = Math.hypot(dx, dy);
      if (step < 0.5) continue;
      const mag = g ? Math.hypot(g[0], g[1]) || 1 : 1;
      const ux = dx / step, uy = dy / step;
      const L = Math.max(6, step - 2.6);
      const ox = it[i][0], oy = it[i][1];
      const ex = ox + ux * L, ey = oy + uy * L;
      const wing = 4.4, px = -uy, py = ux;
      const arrow = svgEl("path", {
        d: `M${r1(ox)} ${r1(oy)}L${r1(ex)} ${r1(ey)}`
          + `M${r1(ex)} ${r1(ey)}L${r1(ex - ux * wing + px * wing * 0.62)} ${r1(ey - uy * wing + py * wing * 0.62)}`
          + `M${r1(ex)} ${r1(ey)}L${r1(ex - ux * wing - px * wing * 0.62)} ${r1(ey - uy * wing - py * wing * 0.62)}`,
        fill: "none",
        stroke: "var(--warm, #E8A33D)",
        "stroke-width": "1",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: "0",
      });
      svg.appendChild(arrow);
      marks.push({ ox, oy, ex, ey, ux, uy, mag, start: nAcc });
      notes.push({ el: arrow, start: nAcc, opacity: 0.9 });

    }

    if (it.length && mathHost) {
      const mw = Math.min(158, Math.max(108, avail * 0.27));
      const mh = Math.round(mw * 0.29);
      const cluster = marks.length ? marks : null;
      const cx = cluster ? cluster.reduce((a, m) => a + m.ox, 0) / cluster.length : nameX + avail - mw / 2;
      const cyLo = cluster ? Math.max(...cluster.map((m) => Math.max(m.oy, m.ey))) : nameY;
      const mx = Math.min(nameX + Math.max(mw, avail) - mw, Math.max(nameX, cx - mw / 2));
      const my = cyLo + mh * 0.48 + 30;

      mathHost.style.width = `${Math.round(mw)}px`;
      mathHost.style.height = `${mh}px`;
      mathHost.style.left = `${r1(Math.max(0, mx - nameX))}px`;
      mathHost.style.top = `${r1(my - nameY - mh * 0.48)}px`;
      if (typeof mathHost.__resize === "function") mathHost.__resize();
      const hb = nameHost.getBoundingClientRect(), mb = mathHost.getBoundingClientRect();
      const over = mb.right - hb.right;
      if (over > 0.5) mathHost.style.left = `${r1(parseFloat(mathHost.style.left) - over)}px`;
      notes.push({ el: mathHost, start: marks.length ? marks[0].start : 0, opacity: 1, html: true });

    }

    svg.append(leader);

    nameHost.style.position = "relative";
    nameHost.style.height = `${Math.round(raster.cssH)}px`;
    nameHost.querySelectorAll(":scope > svg").forEach((el) => el.remove());
    nameHost.appendChild(svg);
  };

  const DELAY = 350, SLOW = 3000, FAST = 3100;
  const timeAt = (x) => (x <= slowLen
    ? (slowLen ? (x / slowLen) * SLOW : 0)
    : SLOW + ((x - slowLen) / Math.max(1, totalLen - slowLen)) * FAST);

  const settle = () => {
    parts.forEach((p) => {
      p.el.removeAttribute("stroke-dasharray");
      p.el.setAttribute("stroke-dashoffset", "0");
      p.el.setAttribute("opacity", String(p.opacity));
    });
    if (bloom) bloom.setAttribute("opacity", "0");
    dots.forEach((d) => d.el.setAttribute("opacity", "0.95"));
    notes.forEach((n) => {
      if (n.html) n.el.style.opacity = "0";
      else n.el.setAttribute("opacity", "0");
    });
    leader.setAttribute("opacity", "0");
  };

  const play = () => {
    anims.forEach((a) => a.cancel());
    anims = [];
    if (!leader.animate) { settle(); return; }
    const ease = "linear";

    parts.forEach(({ el, len, start, opacity, dash }) => {
      el.setAttribute("stroke-dasharray", dash);
      el.setAttribute("stroke-dashoffset", String(len));
      const delay = DELAY + timeAt(start);
      const dur = Math.max(50, timeAt(start + len) - timeAt(start));
      const a = el.animate({ strokeDashoffset: [len, 0] }, { duration: dur, delay, easing: ease, fill: "forwards" });
      a.onfinish = () => el.setAttribute("stroke-dashoffset", "0");
      anims.push(a);
      const fade = el.animate([{ opacity: 0 }, { opacity }], { duration: 1, delay, fill: "both" });
      fade.onfinish = () => el.setAttribute("opacity", String(opacity));
      anims.push(fade);
    });

    const lead = leader.animate(
      [
        { strokeDashoffset: 18, opacity: 0.95, offset: 0 },
        { strokeDashoffset: 18 - slowLen, opacity: 0.95, offset: SLOW / (SLOW + FAST) },
        { strokeDashoffset: 18 - totalLen, opacity: 0, offset: 1 },
      ],
      { duration: SLOW + FAST, delay: DELAY, easing: ease, fill: "forwards" },
    );
    lead.onfinish = () => leader.setAttribute("opacity", "0");
    anims.push(lead);

    dots.forEach(({ el, start }) => {
      const at = DELAY + timeAt(start);
      const a = el.animate(
        [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.999 }, { opacity: 0.95, offset: 1 }],
        { duration: Math.max(1, at + 90), easing: "linear", fill: "forwards" },
      );
      anims.push(a);
    });

    notes.forEach(({ el, start, opacity, html }) => {
      if (html) el.style.opacity = "0"; else el.setAttribute("opacity", "0");
      const inAt = DELAY + timeAt(start);
      const a = el.animate([{ opacity: 0 }, { opacity }], { duration: 340, delay: inAt, easing: "ease-out", fill: "forwards" });
      anims.push(a);
      const b = el.animate([{ opacity }, { opacity: 0 }], { duration: 420, delay: DELAY + SLOW * 0.92, easing: "ease-in", fill: "forwards" });
      b.onfinish = () => { if (html) el.style.opacity = "0"; else el.setAttribute("opacity", "0"); };
      anims.push(b);
    });

    const cs = getComputedStyle(document.documentElement);
    const line = (cs.getPropertyValue("--line") || "#E6E2D8").trim() || "#E6E2D8";
    const warm = (cs.getPropertyValue("--warm") || "#E8A33D").trim() || "#E8A33D";
    rings.forEach((el, i) => {
      const base = Number(el.getAttribute("opacity")) || 0.075;
      const a = el.animate(
        [
          { stroke: line, opacity: base },
          { stroke: warm, opacity: Math.min(base + 0.08, 0.24), offset: 0.3 },
          { stroke: line, opacity: base },
        ],
        { duration: 1200, delay: DELAY + SLOW + FAST + 100 + Math.floor(i / 2) * 42, easing: "ease-out" },
      );
      anims.push(a);
    });

    if (bloom) bloom.setAttribute("opacity", "0");
  };

  const sweepSpecular = (delayMs) => {
    if (!sheen) return;
    cancelAnimationFrame(sheenRaf);
    const t0 = performance.now() + delayMs;
    const DUR = 1500;
    const step = (now) => {
      if (!sheen) return;
      const u = (now - t0) / DUR;
      if (u >= 1) {
        sheen.spec.setAttribute("gradientTransform", `translate(${(sheen.span * 1.2).toFixed(1)} 0)`);
        return;
      }
      const e = u <= 0 ? 0 : u * u * (3 - 2 * u);
      sheen.spec.setAttribute("gradientTransform", `translate(${(e * sheen.span).toFixed(1)} 0)`);
      sheenRaf = requestAnimationFrame(step);
    };
    sheenRaf = requestAnimationFrame(step);
  };

  const reduce = false;
  const recheck = () => {
    if (geometryKey() === builtKey) { recheckDepth = 0; return; }
    if (recheckDepth++ > 4) return;
    start();
  };

  const start = () => {
    build();
    if (reduce) { settle(); cancelAnimationFrame(sheenRaf); }
    else { play(); }
    clearTimeout(recheckTimer);
    requestAnimationFrame(() => requestAnimationFrame(recheck));
    recheckTimer = setTimeout(recheck, 420);
  };

  const geometryKey = () => {
    const container = fieldSvg.parentElement;
    const [x, y] = offsetIn(nameHost, container);
    return [x, y, nameHost.offsetWidth, Math.max(320, container.clientWidth), contentHeight(container)].join("|");
  };

  start();
  nameHost.addEventListener("click", () => { if (!reduce) play(); });
  if (!reduce && replayMs) timer = setInterval(play, replayMs);

  const rebuild = () => { recheckDepth = 0; recheck(); };
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(rebuild, 200); };
  window.addEventListener("resize", onResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onResize);
    window.visualViewport.addEventListener("scroll", onResize);
  }
  const ro = new ResizeObserver(onResize);
  ro.observe(nameHost);
  ro.observe(document.body);
  ro.observe(fieldSvg.parentElement);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuild).catch(() => undefined);

  return {
    destroy() {
      clearInterval(timer);
      clearTimeout(resizeTimer);
      clearTimeout(recheckTimer);
      cancelAnimationFrame(sheenRaf);
      sheen = null;
      window.removeEventListener("resize", onResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", onResize);
        window.visualViewport.removeEventListener("scroll", onResize);
      }
      ro.disconnect();
      anims.forEach((a) => a.cancel());
    },
  };
}
