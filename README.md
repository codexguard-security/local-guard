# local-guard

**Verify that your built web app cannot send user data anywhere — across every shipped file, not just the entry point.**

Zero dependencies. Node 16+. Exit code `0` / `1`, so it works as a CI gate.

```bash
npx @origguard-web/local-guard --target dist            # public build: declared exceptions allowed
npx @origguard-web/local-guard --target dist --strict   # sold/offline deliverable: zero tolerance
```

---

## Why this exists

If your product's selling point is "your files never leave your device", you have a problem no test suite covers: **that promise is true on launch day and silently false three dependencies later.** Nobody notices, because nothing fails.

`local-guard` turns the promise into something a machine checks on every build.

## The mistake it exists to prevent

Most privacy claims are worded as **"no network requests"**. That is almost always false — an ad script, a CDN font, or an update check disproves it — and the audience such a claim attracts is exactly the audience that opens DevTools to check.

The accurate wording is stronger, because it survives inspection:

> **No user data is sent to a server.**

`local-guard` supports that distinction directly through its two modes: your public build may carry *declared* exceptions (each requiring a written reason), while `--strict` tolerates none.

## What it checks

Nine outbound mechanisms, across **every** shipped file:

| | Why it matters |
|---|---|
| `fetch`, `XMLHttpRequest` | the obvious ones |
| `navigator.sendBeacon` | **leaves no visible trace** in the Network tab |
| `WebSocket`, `EventSource` | persistent connections are not shown as requests |
| remote `<form action>` | posts straight to a server |
| third-party `src` / `href` | a CDN font hands the user's IP and page to someone else |
| remote `@import` | remote stylesheet |
| `import()` to a URL | loads code from elsewhere |

**It scans every file, not the entry point.** This is the rule that costs the most when ignored: a `WebSocket` added in a secondary bundle would pass a check limited to `app.js`, and would leave no trace in the Network tab.

An `<a href="https://…">` link is **not** flagged — that is intended navigation, not a resource load.

## Declared exceptions

Create `local-guard.json` next to your build:

```json
{
  "allow": [
    {
      "pattern": "pagead2.googlesyndication.com",
      "reason": "Ad script funding the free version. Carries no user data."
    }
  ]
}
```

Every exception **requires a reason**, and the tool warns when one is missing. An undocumented exception is how a leak becomes permanent. `--strict` ignores this file entirely.

## CI

```yaml
- run: npm ci && npm run build
- run: npx local-guard --target dist --strict
```

## What it does not do

**Static analysis is evadable.** Obfuscation — `eval`, dynamically built strings, `Function()` — can hide a mechanism from any scanner. Detecting network calls statically is not decidable in general.

So `local-guard` is **defence in depth, not the guarantee.** The guarantee is enforcement by the browser:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; connect-src 'none'; form-action 'none';
               object-src 'none'; base-uri 'none'">
```

`connect-src 'none'` makes the browser **block** fetch, XHR, WebSocket, EventSource and sendBeacon. Because the policy sits inside the HTML, it is covered by the artifact's hash: it cannot be removed without changing that hash.

Use both. Never present the scan as the guarantee.

## Related

Part of a set of verification tools by [ORIGGUARD](https://origguard.com):
`delivery-gate` (a gate that produces the deliverable only if every documented check passes), `attest-op` and `translog` (see the [OVP-1 specification](https://github.com/codexguard-security/ovp)).

## License

Apache-2.0. See `LICENSE`.
