## Questions and feature matrix

This describes **only the self-authored fixture**, whose known implementation is in `tools/web-capture/fixture_server.mjs`. Run `demo.mjs` to attach a fresh session and measurements. It is not evidence about a shipping competitor.

| Feature | Entry/input | Trigger and states | Data flow and boundary |
|---|---|---|---|
| Search | Query input, Search button; no account | Click → parallel diagnostic requests → GraphQL → ready | `query.value` → `variables.q`; named Search operation; JSON `state` → output. Diagnostic 500/abort does not prevent success because the fixture explicitly catches failures. |
| Pagination | Next button, initial page counter 1 | Click increments to 2 → fetch → render 2 | Query `page=2` → response `page=2`. Empty items do not remove the page label. Further limits are not implemented. |
| Form | Required email input | Empty submit blocked by native validation; valid input → saved | URL-encoded form → JSON state → output. Email is masked before persistence. No real account is created. |
| Stream | Streams button | EventSource message and WebSocket receive → completion markers | SSE result event and WS sent/received JSON are in streams.jsonl; completion markers are assertions, not visible loading UX. |

## Trace and explanations

Search button handler → query value → `fetch('/graphql', …)` → response JSON → `#result.textContent`. Each step is readable in the fixture and exercised by the browser runner. The session's network rows and before/after snapshots provide the runtime anchors; report.json resolves the HTTP IDs.

A timing match could also be background polling. The independent server request log and the known handler distinguish that alternative here. For a real product, inspect initiators, payload and UI changes or retain the claim as inferred. CDP request IDs and Playwright HTTP IDs are different namespaces and are not automatically joined.

`/error` is HTTP 500 with a readable JSON body; `/abort` is transport failure. `/empty` is empty by status, `/unknown` lacks a bounded length, and `/large` exceeds the configured limit. None should be collapsed into “no response”. The fixture intentionally lacks a retry UX: do not infer retry policy from duplicate transport attempts.

## Own implementation proposal

A comparable product can separate query state, request state and displayed results; attach a generation ID to each search and disregard stale responses. Keep validation close to input and display recoverable errors. This is a design proposal, not a finding that the fixture implements cancellation or stale-result protection. Test empty results, invalid input, response reordering, retry and stream disconnection before shipping.

## Coverage and verdict

| Claim | Verdict | Boundary |
|---|---|---|
| Fixture search/page/form data flow | PASS after the runner completes | Only the provided fixture and installed Chromium |
| SSE messages and bidirectional WS payload observation | PASS after integration assertions | Attached main target; worker/OOPIF streams remain uncovered |
| Time-window candidate implies causal ownership | SKIP | Requires additional evidence |
| Stale-result protection would improve a real search UI | PLAUSIBLE proposal | Not implemented or measured in fixture |
| Real backend design, scale, pricing, cross-browser behavior | SKIP | Not represented by this fixture |
