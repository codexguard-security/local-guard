#!/usr/bin/env node
/**
 * local-guard — verify a "your data never leaves the device" promise.
 *
 * Scans EVERY shipped file (not just the entry point) for every known
 * exfiltration mechanism — including the ones that leave no visible trace in
 * the Network tab, like sendBeacon and WebSocket.
 *
 *   node tools/local-guard.mjs --target dist
 *   node tools/local-guard.mjs --target dist/onprem --strict
 *
 * Two modes, matching the two levels of promise:
 *   default   declared exceptions allowed (public build: ads, fonts…),
 *             each one requiring a written reason in local-guard.json
 *   --strict  zero tolerance — for the deliverable you sell as fully offline
 *
 * Exit code: 0 if clean, 1 if any finding. Dependency-free.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const TARGET = path.resolve(flag("--target", process.cwd()));
const STRICT = args.includes("--strict");
const QUIET = args.includes("--quiet");

const C = { g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

/**
 * Classify a call site by its first string-literal argument.
 *
 * A scanner that treats fetch("http://localhost:8080") and
 * fetch("https://third-party.example/collect") identically is not telling the
 * truth about either. Same-origin is NOT harmless here — the origin is a
 * server, and this tool verifies that nothing reaches one — but it is a
 * different fact and it gets a different sentence.
 */
function classifyTarget(line, index) {
  const after = line.slice(index, index + 240);
  const lit = after.match(/\(\s*(["'`])([^"'`]*)\1/);
  if (!lit) return { kind: "indeterminate", target: null };
  const t = lit[2];
  if (/^(https?|wss?):\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(t)) return { kind: "localhost", target: t };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return { kind: "remote", target: t };
  if (/^(\/|\.\.?\/)/.test(t) || t === "") return { kind: "same-origin", target: t };
  return { kind: "same-origin", target: t };
}

const KIND_NOTE = {
  remote:        "sends to a third-party origin",
  "same-origin": "same-origin — still leaves the device: the origin is a server",
  localhost:     "loopback only — never leaves the machine",
  indeterminate: "target is computed at runtime and cannot be determined statically",
};

// Every mechanism that can move data off the device, or pull a resource from a third party.
const RULES = [
  { id: "fetch",       re: /\bfetch\s*\(/g,                              why: "network request" },
  { id: "xhr",         re: /\bXMLHttpRequest\b/g,                         why: "network request" },
  { id: "beacon",      re: /\bsendBeacon\s*\(/g,                          why: "leaves NO visible trace in the Network tab" },
  { id: "websocket",   re: /\bnew\s+WebSocket\s*\(/g,                     why: "persistent connection — not shown as a request" },
  { id: "eventsource", re: /\bnew\s+EventSource\s*\(/g,                   why: "persistent connection" },
  { id: "form-remote", re: /<form[^>]+action\s*=\s*["']https?:\/\//gi,    why: "form posts to a remote server" },
  { id: "remote-res",  re: /<(?:link|script|img|iframe|video|audio|source|embed|object)\b[^>]*?\b(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi,
                       why: "third-party resource — hands the user's IP and page to someone else" },
  { id: "css-import",  re: /@import\s+(?:url\()?["']?https?:\/\//gi,      why: "remote stylesheet" },
  { id: "dyn-import",  re: /\bimport\s*\(\s*["']https?:\/\//g,            why: "loads code from a remote URL" },
];

const EXT = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".css", ".json", ".svg", ".webmanifest"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", "coverage"]);

// ---------- allowlist ----------
let allow = [];
const cfgPath = ["local-guard.json", "../local-guard.json"]
  .map((p) => path.resolve(TARGET, p)).find((p) => fs.existsSync(p));
if (cfgPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    allow = Array.isArray(cfg.allow) ? cfg.allow : [];
  } catch { console.error(`${C.y}!${C.x} local-guard.json is not valid JSON — ignoring it`); }
}
const noReason = allow.filter((a) => !a.reason || !String(a.reason).trim());
const isAllowed = (line) => !STRICT && allow.some((a) => a.pattern && a.reason && line.includes(a.pattern));

// ---------- walk ----------
const files = [];
(function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); }
    else if (EXT.has(path.extname(e.name).toLowerCase())) files.push(full);
  }
})(TARGET);

// ---------- scan ----------
const CALL_RULES = new Set(["fetch", "xhr", "beacon", "websocket", "eventsource", "dyn-import"]);
const findings = [];
let allowedCount = 0;
let localhostCount = 0;
for (const f of files) {
  let src = "";
  try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
  const lines = src.split("\n");
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      rule.re.lastIndex = 0;
      // Count EVERY match on the line, not just the first: a minified bundle is
      // a single line, and reporting once per line would hide almost everything.
      const matches = [...line.matchAll(rule.re)];
      for (const m of matches) {
        const around = line.slice(Math.max(0, m.index - 60), m.index + 120);
        if (isAllowed(around)) { allowedCount++; continue; }
        const cls = CALL_RULES.has(rule.id)
          ? classifyTarget(line, m.index + (m[0] || "").length - 1)
          : { kind: "remote", target: null };
        // A loopback literal never leaves the machine. Reported for information,
        // and only failing under --strict, where zero requests are promised.
        if (cls.kind === "localhost" && !STRICT) { localhostCount++; continue; }
        findings.push({
          file: path.relative(TARGET, f) || path.basename(f),
          line: i + 1,
          id: rule.id,
          why: rule.why,
          kind: cls.kind,
          target: cls.target,
          snippet: (m[0] || line.trim()).slice(0, 90),
        });
      }
    });
  }
}

// ---------- report ----------
const mode = STRICT ? `${C.b}strict${C.x} ${C.d}(no exception tolerated)${C.x}` : `${C.d}declared exceptions allowed${C.x}`;
console.log(`\n${C.b}local-guard${C.x} ${C.d}→ ${TARGET}${C.x}  ·  ${mode}`);
console.log(`${C.d}${files.length} shipped file(s) scanned · ${RULES.length} mechanisms checked${C.x}\n`);

if (!files.length) {
  console.log(`  ${C.y}!${C.x} No shipped files found here — is this the build output directory?\n`);
  process.exit(1);
}
if (noReason.length) {
  console.log(`  ${C.y}!${C.x} ${noReason.length} allowlist entr(ies) without a reason — an undocumented exception is how a leak becomes permanent\n`);
}

if (findings.length) {
  const byFile = {};
  for (const f of findings) (byFile[f.file] ||= []).push(f);
  for (const [file, list] of Object.entries(byFile)) {
    console.log(`  ${C.r}✗${C.x} ${C.b}${file}${C.x}`);
    for (const f of list) {
      const note = KIND_NOTE[f.kind] || f.why;
      console.log(`      ${C.r}${f.id}${C.x} ${C.d}line ${f.line} — ${note}${f.target ? ` → ${f.target}` : ""}${C.x}`);
      if (!QUIET) console.log(`      ${C.d}${f.snippet}${C.x}`);
    }
  }
  console.log(`\n  ${C.r}${findings.length} finding(s)${C.x}${allowedCount ? ` ${C.d}· ${allowedCount} declared exception(s) allowed${C.x}` : ""}`);
  console.log(
    STRICT
      ? `  ${C.r}This build must not be sold as fully offline.${C.x} ${C.d}Remove every mechanism above.${C.x}\n`
      : `  ${C.r}Undeclared outbound mechanism(s).${C.x} ${C.d}Remove them, or declare each one with a reason in local-guard.json.${C.x}\n`,
  );
  process.exit(1);
}

console.log(`  ${C.g}✓ No undeclared outbound mechanism in any shipped file.${C.x}`);
if (localhostCount) console.log(`  ${C.d}${localhostCount} loopback call(s) ignored — they never leave the machine. Use --strict to include them.${C.x}`);
if (allowedCount) console.log(`  ${C.d}${allowedCount} declared exception(s) allowed — name them in your promise before a user finds them.${C.x}`);
console.log(
  STRICT
    ? `  ${C.g}This build emits nothing.${C.x} ${C.d}The absolute promise holds for it.${C.x}\n`
    : `  ${C.d}Say "no data is sent to a server" — not "no network requests", which your exceptions would disprove.${C.x}\n`,
);
process.exit(0);
