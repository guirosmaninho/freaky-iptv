# App clarity and performance — 22 October 2026

Source: GitHub main at `cec7357` (Fixed buffering issues). The clean local checkout preserves that commit's buffering and transport changes. Earlier Google Drive work supplied interface/localization references and the verified macOS-runtime preparation script. The GitHub host and renderer playback changes are retained.

## Changes

- Home: compact channel recommendation, favorites and recent channels; first-run setup has one playlist action. Removed taglines, repeated captions and the instructional walkthrough.
- Live TV and Guide: bounded virtual collections instead of append-only scrolling. Independent filters, density and position survive tab switches. Focused controls remain mounted during pointer scrolling. Empty results offer recovery actions.
- Guide: retain column headings, times and reminders; remove repeated row labels. Cache time formatters and shared schedule results. Resolve ordinary current-programme lookups before building a full overlap index.
- Settings: category navigation replaces the long page. Field, section and action labels carry the meaning; zero-value refresh/history options use Off and Keep forever controls. URL masking, validation and destructive confirmations remain.
- Recordings, About, statistics, reviews and player: remove introductions, taglines, duplicate labels and promotional chapter titles. Preserve meaningful metadata and errors. Correct light-mode reminder contrast and sidebar selection text.
- Startup: concurrent independent settings/cache/history/reminder reads, dashboard statistics on demand, nonblocking storage inspection, lazy screens and on-demand Portuguese catalogue.
- Imports: M3U and XMLTV parsing run in a short-lived background worker with cleanup and timeout. The same pure parsers serve tests and runtime. Malformed guides retain the previous valid guide. Network validation remains in the host.
- Recording previews: at most two FFmpeg tasks, single decoder/encoder/filter threads, timeout per extraction attempt, duplicate task/cache-write sharing.
- Native compatibility: replace the Intel-only NuGet macOS payload with checksum-pinned official LibVLC for each target architecture, preserve library symlinks and add a runtime-load probe.
- Packaging: resolve and unpack the SQLite worker outside ASAR; reject stale worker events and enforce the worker file in both platform verifiers.
- Maintenance: focused collection, formatting, parsing and queue helpers; smaller settings primitives; root AGENTS.md with boundaries and reproducible validation commands.
- Language: apply the existing language setting throughout primary screens; Portuguese values stay separate from provider channel/programme names.

## Evidence to retain

- A cold 10,000-programme lookup originally read 20,000 timestamp fields. The regression now requires fewer than 100 reads and also checks overlapping entries and tick invalidation.
- Queue regressions check concurrent-job limits, FIFO starts and recovery after rejection.
- Worker/client tests check metadata, malformed XML, cleanup, error propagation and retry.
- The 2,000-channel Electron fixture checks actual parser worker construction, bounded channel/guide DOM, the last channel and preservation of a valid guide after malformed XML.
- Locale tests check on-demand translation and date formatter invalidation. Electron checks exercise Portuguese, light/dark preview and discard, keyboard reminders, saved filters and scrolling.

## Boundaries

No installers or releases are published by this change. Matching-platform installer execution, Intel/Windows playback, production IPTV-provider behaviour and sustained native decode profiling require their own environment. A large lazy-loaded HLS library still triggers Vite's existing 500 KB chunk warning; it is loaded only when needed for playback.

## Final checks

Implementation validated on branch `codex/ux-performance` before release 1.1.3.

- Node 24.19.0; npm, renderer types/Vite build and lint pass.
- `npm test`: 183 passed, zero failures or skips.
- Matching ARM host build passes, with official runtime checksum/architecture checks. All 337 native dylibs were inspected as ARM64, and symlinks remain within the runtime tree. The helper's `--verify-runtime` succeeds; a warm probe took 3.1 seconds. Initial loading of newly copied native libraries was much slower, so this is not a cold-start performance claim.
- After the host build, `npx playwright test --grep-invert 'native fullscreen'`: 15 passed. Coverage includes screen sizes, real playback/zapping, screenshots and clipboard, source MKV recording, statistics/reviews, a 2,000-channel worker import, malformed-guide retention, filters/scroll/focus, English/Portuguese, light/dark themes, number editing and statistics-error recovery.
- Native fullscreen entry fails on the unchanged GitHub baseline too. The entry and dependent stop-in-fullscreen flows were excluded from the successful 15-test run. Fullscreen host behavior is unchanged; manual verification remains required.
- Main JavaScript: 321.54 KB → 283.25 KB (11.9% smaller); gzip 99.50 KB → 89.57 KB (10.0% smaller). Portuguese, secondary screens, the XML fallback and playback libraries load separately. These are bundle measurements, not an unmeasured frame-rate or startup-time claim.
- Independent review findings on XML strictness, translation readiness and recoverable errors were resolved.
- Dependency audit found 28 inherited advisories (9 moderate, 17 high, 2 critical) in the existing dependency graph. Broad dependency upgrades were not included in this interface/performance change.

Screenshots are under `output/playwright/` (ignored by Git). Native installers, Intel/Windows execution and production provider streams were not tested. The packaged macOS ARM smoke check is recorded below.

- Final packaged ARM smoke: unsigned local app bundle starts, its unpacked SQLite worker loads history/reminders, and its bundled LibVLC passes `--verify-runtime`. Data is disposable. No installer or update was published.
- Final guide-spacing revision: all six navigation checks pass after the narrow light-theme adjustment.

- Final complete independent UI rerun: all 15 passed in 49.3 seconds with deterministic fixture-owned process cleanup; lint and diff whitespace checks pass.
