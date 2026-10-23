# App map

`main.cjs` owns the native window, network validation, media processes and trusted IPC. `preload.cjs` exposes the typed bridge in `src/types.ts`. SQLite access runs in `electron/dataWorker.cjs`; its ASAR unpacking rule is part of the package contract.

`src/App.tsx` coordinates settings, channel library, EPG clocks, playback sessions and screen selection. Screens load on demand. Playback timing and byte counters continue independently of visible diagnostics.

`src/services/collectionWindow.ts` computes a bounded row window. `src/hooks/useVirtualCollection.ts` measures its viewport and preserves focused controls; `useNavigationState.ts` coalesces optional storage writes and flushes on unmount. Live TV and Favorites must use distinct React keys.

`src/services/epgSchedule.ts` caches timestamp ranges and overlap indexes by immutable programme arrays. `createChannelEpgReader` shares schedule results for one clock tick, including quality variants. Replace arrays on guide updates; do not mutate cached programme times.

`src/main.tsx` configures the worker URL. `parserWorkerClient.ts` owns worker lifetime and errors; `playlistParser.worker.ts` invokes the same M3U/XMLTV parsers used by tests. Downloads remain in the trusted host and keep private-network restrictions. XML parsing uses pinned saxes in one pass without building a DOM. The synchronous fallback loads only when no worker factory is available.

`src/services/i18n.ts` stores the language preference and publishes revisions. `useI18n.ts` subscribes React components. The Portuguese catalogue loads only when needed. Pass provider data as interpolation parameters so translation never rewrites channel or programme names.

`electron/streamingHttpCore.cjs` is shared by source downloads and playback relays. `httpCompatibility.cjs` adapts only identical repeated Content-Length values before Node's strict parser; keep destination pinning, TLS checks, framing rejection and bounded headers intact. The host's close handshake waits for renderer history/recording completion, then closes the window and database worker before resuming quit. A canceled close must restore normal operation.

`electron/taskQueue.cjs` bounds expensive thumbnail work. The host deduplicates a thumbnail's extraction and cache write, applies per-process timeouts and limits FFmpeg threads. `prepare-macos-libvlc.cjs` supplies checksum-pinned architecture-specific native libraries and preserves their symlinks; the helper supports `--verify-runtime`.

Run `npm test`, `npm run lint`, and `npm run build:renderer` for service/host contracts, lint and renderer validation. `npm run test:e2e` additionally builds native host assets; focused Electron checks can run with `npx playwright test` after the renderer and required host assets exist. All Electron fixtures use disposable data directories.
