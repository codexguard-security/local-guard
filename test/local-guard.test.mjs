/**
 * Test suite — no dependencies.
 * Each case corresponds to a way a privacy promise silently becomes false.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const GUARD = path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..", "src", "local-guard.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`PASS - ${n}`)) : (fail++, console.log(`FAIL - ${n}${x ? ` :: ${x}` : ""}`)); };

async function project(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lg-"));
  for (const [p, c] of Object.entries(files)) {
    const full = path.join(dir, p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, c);
  }
  return dir;
}
function run(dir, ...args) {
  try {
    const out = execFileSync("node", [GUARD, "--target", dir, ...args], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

console.log("\n=== Clean build passes ===");
{
  const d = await project({
    "index.html": `<html><body><a href="https://example.com">Our site</a><script src="app.js"></script></body></html>`,
    "app.js": `const b = new Blob([data]); URL.createObjectURL(b);`,
  });
  const r = run(d, "--quiet");
  ok("exit 0 on a clean build", r.code === 0, r.out);
  ok("a plain <a href> link is not flagged", !/remote-res/.test(r.out));
  await fs.rm(d, { recursive: true, force: true });
}

console.log("\n=== Every shipped file is scanned, not just the entry point ===");
{
  const d = await project({
    "index.html": `<html><script src="app.js"></script></html>`,
    "app.js": `console.log("clean");`,
    "vendor/extra.js": `export const s = (d) => fetch("https://api.example.com/up", { method: "POST", body: d });`,
  });
  const r = run(d, "--quiet");
  ok("fetch hidden in a secondary file is caught", r.code === 1 && /extra\.js/.test(r.out), r.out);
  await fs.rm(d, { recursive: true, force: true });
}

console.log("\n=== Mechanisms that leave no trace in the Network tab ===");
{
  const d = await project({ "index.html": "<html></html>", "t.js": `navigator.sendBeacon("/t", p); const s = new WebSocket("wss://x.example");` });
  const r = run(d, "--quiet");
  ok("sendBeacon caught", /beacon/.test(r.out));
  ok("WebSocket caught", /websocket/.test(r.out));
  await fs.rm(d, { recursive: true, force: true });
}

console.log("\n=== Third-party resources ===");
{
  const d = await project({ "index.html": `<html><head><link href="https://fonts.example/css" rel="stylesheet"></head><body><script src="https://cdn.example/a.js"></script></body></html>` });
  const r = run(d, "--quiet");
  ok("CDN font and remote script both caught", (r.out.match(/remote-res/g) || []).length === 2, r.out);
  await fs.rm(d, { recursive: true, force: true });
}

console.log("\n=== Declared exceptions, and --strict ===");
{
  const files = {
    "index.html": `<html><body><script src="https://ads.example/a.js"></script></body></html>`,
    "local-guard.json": JSON.stringify({ allow: [{ pattern: "ads.example", reason: "Ad script funding the free version. Carries no user data." }] }),
  };
  const d = await project(files);
  ok("declared exception passes in default mode", run(d).code === 0);
  ok("the same build FAILS under --strict", run(d, "--strict").code === 1);
  await fs.rm(d, { recursive: true, force: true });

  const d2 = await project({ ...files, "local-guard.json": JSON.stringify({ allow: [{ pattern: "ads.example" }] }) });
  ok("an exception without a reason is reported", /without a reason/.test(run(d2).out));
  await fs.rm(d2, { recursive: true, force: true });
}

console.log("\n=== Empty target ===");
{
  const d = await project({ "readme.txt": "no shipped files here" });
  ok("empty build directory fails loudly", run(d).code === 1);
  await fs.rm(d, { recursive: true, force: true });
}

console.log(`\n${"=".repeat(44)}\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
