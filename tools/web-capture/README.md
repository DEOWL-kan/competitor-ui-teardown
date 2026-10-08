# Optional Web capture runtime

Requires Node.js 20+ and the lockfile's Playwright. Core Python tools do not depend on it. Install only after the user has authorized installation:

```sh
cd tools/web-capture
npm ci
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright install chromium
npm run check
npm test
```

`python3 scripts/preflight.py --web` from the repo root launches Chromium and checks CDP without calling adb. Verified runtime versions are recorded in each manifest; `--check` does not install anything.

## Capture a normal authorized flow

Create a job **outside the repo**:

```json
{
  "url": "https://example.test/",
  "out": "/outside/repo/new-capture",
  "selector": "#search-panel",
  "allowQuery": ["page"],
  "allowFields": ["operationName", "state"],
  "steps": [
    {"id": "search", "selector": "#query", "fill": "books", "waitFor": "#results"},
    {"id": "next", "selector": "#next", "click": true, "waitFor": "#page-two"}
  ]
}
```

```sh
node tools/web-capture/capture.mjs --job /outside/repo/job.json
node tools/web-capture/capture.mjs --import-har /outside/repo/input.har --out /outside/repo/new-import
node tools/web-capture/demo.mjs --out /outside/repo/new-fixture-case
python3 scripts/check_report.py /outside/repo/new-fixture-case/report.json --capture /outside/repo/new-fixture-case
```

Use selectors observed in the actual page. The top-level selector scopes DOM/style snapshots (default body); network collection remains context-wide. Each computed style records at most 64 CSS variables with explicit count/truncation flags. A `waitFor` selector must represent the **new** state; a selector already visible can end the action too early. Each step has exactly one fill/click/press operation. The initial navigation has ID `navigate`. For richer flows, import `startCapture` and call `action(id, async page => {...})`; always `stop()` in finally. The fixture demo exercises search, pagination, invalid/valid form and streams.

The browser uses a fresh context, no personal profile or existing cookies. No endpoints are replayed. Default limits: 5,000 HTTP requests, 2,000 CDP events, 256 KiB/body and 20 MiB of decoded body content. Body limits are configurable through the programmatic API/job; default output is private. The directory must be new and outside the repo. Dependency/browser folders are ignored; logs and competitor materials must never be committed.

## Evidence, not an automatic architecture verdict

- `manifest.json`: actual runtime versions, limits, dropped counts and coverage gaps.
- `actions.jsonl`: operation windows, before/after probe and screenshot references, completion/failure. The window includes automation and waits; it is not calibrated end-user latency.
- `network.jsonl`: context-level HTTP, IDs, method/type/status, headers, request/response body states, frame/page, redirect parent/hop and duration. Duration is local event elapsed time, not isolated server processing time.
- `streams.jsonl`: CDP initiator frames (zero-based line/column), cache/SW flags, WS sent/received/close/error, EventSource messages. CDP IDs (`page-N:cdp:...`) are **not** Playwright HTTP IDs (`http-N`). Final records retain metadata-based candidate links (page, URL, method, redirect hop and time); ambiguity stays explicit, never an exact identity or causal join. Chromium observes Worker/OOPIF streams; early popup events and service-worker-owned streams may be missing.
- `events.jsonl`: incremental events for recovery; `network.jsonl` is the final HTTP state. Incomplete sessions have `complete:false`.
- `snapshots/`: viewport screenshots plus bounded DOM/style/animation probe. CSP or browser errors can make snapshots unavailable.

HTTP 4xx/5xx can have captured bodies; they are not transport failure. Bodies distinguish `captured`, `empty`, `not_requested`, `unavailable`, `truncated`. The portable HTTP reader skips unknown Content-Length, compression or excessive declared size to bound buffering. Chromium additionally reads bounded decoded bodies directly through CDP, with no resource-reload fallback. Playwright body reads that can refetch are skipped. JSON/form requests are supported; multipart/file bytes are omitted. Strict JSONP callbacks are parsed as JSON without executing JavaScript; arbitrary scripts and binary responses are not parsed as JSON. SSE covers native EventSource, not incremental fetch streams. HAR imports cannot recreate missing stream frames, actions or omitted bodies.

Action IDs on requests are **time-window candidates**, potentially multiple. Unassigned requests remain unassigned; delayed requests after an action are not retroactively attached. Parameter/response/UI evidence and initiators are needed to support a functional claim. `check_report --capture` checks HTTP and stream session/request/action/body references. Stream locators additionally require event_id from streams.jsonl; causation still needs manual review.

Default privacy keeps JSON/form structure and masks leaf values with consistent per-session placeholders. Explicit allow-lists preserve selected fields/query values, except named secrets. Most header values are omitted. **URL paths, field names, screenshots, CSS, allowed values and analyst descriptions can still contain private data.** They require manual review; this is not a guarantee of anonymization. HAR input is capped at 32 MiB and never replayed.

Official backend references: [Playwright Request](https://playwright.dev/docs/api/class-request), [Response](https://playwright.dev/docs/api/class-response), [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

## Browser coverage verified 2026-10-08

Use job `browserName: "firefox"` or `"webkit"`, or `--browser firefox --check`. Install the chosen engines explicitly, then `npm run test:cross`; default tests need only Chromium.

| Backend | Verified coverage | Explicit limit |
|---|---|---|
| Chromium 156 | HTTP, decoded gzip/JSONP, WS, native EventSource, worker/OOPIF streams, cache/SW source flags, DOM/style/animation | Child targets pause briefly for attachment; captures are not calibrated performance measurements |
| Firefox 157 / WebKit 27.2 | HTTP, page WS, DOM/style/animation truth fixture | No CDP initiators/cache flags/native SSE capture or child-target stream guarantee |

Each manifest records backend capabilities. CDP body events have their own event/request IDs; a HTTP body marked unavailable stays unavailable even when a CDP candidate has a body. Final `streams.jsonl` includes candidate links added at shutdown; incremental `events.jsonl` does not backfill them. Native EventSource capture does not cover arbitrary fetch streaming.
