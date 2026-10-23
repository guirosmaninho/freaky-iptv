# Working in this app

- Use npm and Node `>=24.15 <25` (see `package.json` and `.nvmrc`).
- Setup and release instructions: `README.md`, `DISTRIBUTION.md`; security policy: `SECURITY.md`.

## Validation

| Change | Command |
| --- | --- |
| Renderer types and bundle | `npm run build:renderer` |
| Lint | `npm run lint` |
| Services and Electron host | `npm test` |
| Electron flows | `npm run test:e2e` |
| Guide/navigation only, after host build | `npx playwright test e2e/navigation.spec.cjs` |

## Boundaries

- `src/App.tsx` owns settings, playback sessions and screen composition.
- `src/components/settings/` owns settings form sections; `src/services/` holds testable parsing, indexing and calculation logic.
- `src/hooks/useVirtualCollection.ts` and `src/services/collectionWindow.ts` control large list rendering and keyboard focus retention.
- `preload.cjs` and `src/types.ts` define the renderer bridge; keep IPC changes aligned with `main.cjs` and contract tests.
- SQLite operations run in `electron/dataWorker.cjs`; keep the worker unpacked in packaged builds.

## Invariants

- Store playback timing and byte accounting independently of visible diagnostics.
- Keep playlist/provider URLs out of logs, reports and visible source fields unless explicitly revealed.
- Keep channel/guide identifiers scoped to their source.
- Treat schedules and channel collections as immutable; lookup caches rely on this.
- Keep screen headings, field labels and action names explicit. Avoid taglines, repeated captions and instructional paragraphs.
- Retain accessible names, error feedback, focus and keyboard navigation when simplifying visible text.
- Add English copy and Portuguese translations together in `src/services/i18nCatalogue.ts`.
- Check large collections, both locales, themes and narrow windows after layout changes.
- Use disposable data directories for Electron checks (`FREAKYIPTV_E2E=1`, `FREAKYIPTV_DATA_DIR`).
- Generated installers and `dist/` do not prove matching-platform playback or installer execution.
