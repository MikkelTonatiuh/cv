// Prints the live CV page to a one-page A4 PDF, so the offline CV is always the
// same as the site. Run from the repo root:
//
//   node tools/print-cv.mjs [out.pdf] [lang: en|da|es]
//
// PHONE="12 34 56 78" adds a phone mark to the contact marks under the photo; the
// number is not stored in the page itself. Needs Playwright (npm i -D playwright).
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.resolve(process.argv[2] || "Mikkel-Chavez-Petersen-CV.pdf");
const lang = process.argv[3] || "en";

/* A small static server for the repo: the page loads its modules over http. */
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".mp3": "audio/mpeg", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 1400 }, reducedMotion: "reduce" });
/* VENDOR=<dir> serves React from local copies where unpkg cannot be reached. */
if (process.env.VENDOR) {
  const v = process.env.VENDOR;
  const map = {
    "react@18.3.1/umd/react.production.min.js": `${v}/react-18.3.1/package/umd/react.production.min.js`,
    "react-dom@18.3.1/umd/react-dom.production.min.js": `${v}/react-dom-18.3.1/package/umd/react-dom.production.min.js`,
    "@babel/standalone@7.29.0/babel.min.js": `${v}/babel-standalone-7.29.0/package/babel.min.js`,
  };
  await context.route("https://unpkg.com/**", (r) => r.fulfill({ status: 200, body: fs.readFileSync(map[r.request().url().replace("https://unpkg.com/", "")]), headers: { "content-type": "application/javascript", "access-control-allow-origin": "*" } }));
}
await context.addInitScript(() => { try { localStorage.setItem("cv-theme", "light"); } catch (e) {} });
const page = await context.newPage();
await page.goto(base);
if (lang !== "en") await page.click(`button:text-is("${lang}")`);
/* The name is written, the portrait has come out of its noise, the terminal rests on its last frame. */
await page.waitForTimeout(9000);
if (process.env.PHONE) {
  /* A phone mark next to the others under the photo. */
  await page.evaluate((phone) => {
    const nav = document.querySelector(".pf-col .contact");
    const a = document.createElement("a");
    a.href = "tel:" + phone.replace(/\s+/g, "");
    a.setAttribute("aria-label", "Phone " + phone);
    a.title = phone;
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.6l1.4 4.2-2 1.4a12 12 0 006.3 6.3l1.4-2 4.2 1.4v2.6a2 2 0 01-2.2 2A16.5 16.5 0 014.6 5.7a2 2 0 012-2.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    nav.insertBefore(a, nav.children[1]);
  }, process.env.PHONE);
}

/* Links in the PDF go to the live site, not to the local server it was printed from. */
const LIVE = "https://mikkeltonatiuh.github.io/voicemaster-rendering/";
await page.evaluate((live) => {
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!/^(https?:|mailto:|tel:|#)/.test(href)) a.setAttribute("href", new URL(href, live).href);
  }
}, LIVE);

/* The largest scale at which it still fits one page. */
const pdfAt = (scale) => page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, scale });
const pagesIn = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
let lo = 0.5, hi = 1, pdf = await pdfAt(1), scale = 1;
if (pagesIn(pdf) > 1) {
  pdf = await pdfAt(lo); scale = lo;
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2, buf = await pdfAt(mid);
    if (pagesIn(buf) <= 1) { lo = mid; pdf = buf; scale = mid; } else hi = mid;
  }
}
scale = Math.round(scale * 1000) / 1000;
fs.writeFileSync(out, pdf);
console.log(`${out} (scale ${scale})`);
await browser.close();
server.close();
