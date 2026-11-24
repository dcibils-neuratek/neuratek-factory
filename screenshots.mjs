//  Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
// The README's pictures of the demo project, in headless Chrome over its
// DevTools protocol, as test_page.mjs drives it. Run by screenshots.py.
//
//     node screenshots.mjs BASE KEY CHROME OUTDIR

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [BASE, KEY, CHROME, OUT] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "factory-shots-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const port = await new Promise((resolve, reject) => {
  let said = "";
  chrome.stderr.on("data", (d) => { said += d; const m = said.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error("Chrome never listened")), 20000);
});
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const waiting = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result?.value;
async function until(expression, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await js(expression)) return true; } catch {} await sleep(100); }
  throw new Error("never: " + expression);
}

// One picture in each theme: NAME-light.png and NAME-dark.png.
async function shoot(name) {
  for (const theme of ["light", "dark"]) {
    await js(`document.documentElement.dataset.theme = "${theme}"; true`);
    await sleep(500);
    writeFileSync(join(OUT, name + "-" + theme + ".png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  }
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 960, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(500);
  await js(`localStorage.setItem("neuratek-factory-key", ${JSON.stringify(KEY)}); localStorage.setItem("neuratek-factory-toured", "1");
            localStorage.setItem("neuratek-factory-project", "demo"); localStorage.setItem("neuratek-factory-view", "board"); true`);
  await send("Page.reload");
  await until(`document.querySelectorAll(".col .cardbox").length >= 10`);
  await shoot("board");

  await js(`document.querySelector('.cardbox[data-id="demo-scan"]').click(); true`);
  await until(`!!document.querySelector(".panel")`);
  await sleep(600);
  await shoot("card");
  await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); true`);

  for (const view of ["queue", "discussions", "decisions"]) {
    await js(`document.querySelector('.side .nav[data-view="${view}"]').click(); true`);
    await sleep(900);
    if (view === "discussions") { await js(`(document.querySelector(".ditem") || {}).click?.(); true`); await sleep(700); }
    await shoot(view);
  }
  console.log("screenshots in " + OUT);
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
