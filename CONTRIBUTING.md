# Contributing

## The one rule for new detections

A new mechanism is added only when it can actually move data off the device or pull a third-party resource. Each addition needs:

1. a test that **fails** without the detection,
2. a test proving it does not flag legitimate code (false positives make a CI gate get disabled, which is worse than having none),
3. a one-line explanation of *what the mechanism does*, shown in the tool's output.

## What this tool must never claim

It must never be presented as proof that a build cannot exfiltrate. Static analysis is evadable; the browser's Content-Security-Policy is the enforcement. Pull requests that blur this line will be declined.

## Tests

```bash
node test/local-guard.test.mjs
```

No dependencies, and none will be added.
