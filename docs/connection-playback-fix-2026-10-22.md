# Connection and playback follow-up — 2026-10-22

The user's real macOS app failed **Test connection** with `Parse Error: Duplicate Content-Length`. The failure was reproduced through computer use with the saved, masked source configuration.

## Changes

- `electron/httpCompatibility.cjs` normalizes repeated or comma-separated, identical decimal Content-Length values before Node's strict HTTP parser receives the response. Conflicting lengths, invalid values and Transfer-Encoding plus Content-Length remain rejected. Header buffering is bounded; Node continues decoding chunked bodies and checking truncation. No insecure parser mode is enabled.
- Source tests identify the playlist and guide separately. An invalid/unavailable guide cannot obscure a successful playlist connection, and optional guides are not reported as zero-programme successes. Non-XMLTV roots (including HTML error pages) are rejected. Error feedback is localized and excludes raw provider details.
- Source downloads and shared playback relays use the same transport. Connections retain the validated numeric destination, requested-hostname TLS verification and redirect target checks. Downloads retain compressed/decompressed size limits. Redirect responses are closed, and malformed redirect URLs reject the promise instead of throwing outside it.
- `App.tsx` detaches the outgoing watch session before queuing its persistence. Previously a channel switch could replace the shared reference before the queued callback ran, causing both history loss and missing startup measurements. Already queued saves are awaited on shutdown even when no session is active.
- Quit intent survives the renderer close handshake. Recording/history finish before database-worker termination; playback relays and media processes are cleaned up on exit. The bounded fallback permits recording's four-second finalization deadline. Canceling the localized unsaved-settings confirmation resets shutdown state and keeps the database available. Database cleanup begins only after the window has approved closing.

## Manual validation

The macOS ARM app passed source connection checks with masked URLs, displayed live video, entered/exited native fullscreen and quit without leaving playback processes running. Responses from one guide source were intermittently invalid; retry succeeded. Source tests now distinguish playlist success from guide failure and retain valid cached guide data.

## Regression evidence

New tests first failed against the affected implementation, then passed after the corresponding fix:

- identical duplicate/comma-separated Content-Length, conflicting and ambiguous framing;
- fragmented informational/final headers, gzip payload bytes, truncated bodies, backpressure and no-header timeout;
- malformed redirect rejection;
- outgoing-session capture, duplicate finalization and shutdown waiting for a blocked history write;
- actual Electron shutdown, recording finalization, missing acknowledgement and canceled/confirmed dirty settings in disposable data directories.

A disposable TLS check accepted the trusted matching hostname and rejected both an untrusted certificate and a trusted certificate for the wrong hostname. The Electron import fixture now exercises the production streaming client with duplicate headers instead of bypassing it with fetch.

Shutdown fixtures launch Electron without a Node inspector so debugger-disconnection behavior cannot mask process-exit results. Final checks: Node 24.19.0, `npm test` **200 passed**, `npm run lint` passed, `npm run build:renderer` passed. `npx playwright test --grep-invert 'native fullscreen'` **19 passed** in 1.1 minutes. The two native-fullscreen automation cases retain their previously documented baseline/environment limitation; the actual packaged app's enter/exit fullscreen was verified through computer use. The lazy HLS bundle retains Vite's existing chunk-size warning.

This report records validation before the subsequent 1.1.3 release. Windows/Intel execution and every provider/channel/network condition are outside this verification.
