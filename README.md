# Freaky IPTV

<p align="center">
  <img src="public/cat_icon.png" alt="Freaky IPTV cat icon" width="128" height="128" />
</p>

<p align="center">
  <a href="https://github.com/guirosmaninho/freaky-iptv/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/guirosmaninho/freaky-iptv/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/guirosmaninho/freaky-iptv/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/guirosmaninho/freaky-iptv" /></a>
  <a href="https://github.com/guirosmaninho/freaky-iptv/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/guirosmaninho/freaky-iptv?include_prereleases&label=release" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6.svg" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-42-47848f.svg" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078d4.svg" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-339933.svg" />
  <img alt=".NET" src="https://img.shields.io/badge/.NET-8-512bd4.svg" />
</p>

Freaky IPTV is a Windows desktop IPTV player built with React, TypeScript,
Electron, Vite, .NET 8, LibVLC, and FFmpeg.

It plays user-provided M3U playlists and XMLTV guides. It does not include,
sell, proxy, or recommend IPTV subscriptions, channels, streams, playlists, or
EPG data.

Last reviewed: 2026-07-08.

## Features

- M3U playlist and XMLTV guide support.
- HLS and MPEG-TS playback.
- Native playback fallbacks through LibVLC and FFmpeg for difficult streams.
- Fullscreen playback, Picture-in-Picture, frame capture, and source recording.
- Favourites, recent channels, local watch history, statistics, and viewing reviews.
- Windows DPAPI and Electron `safeStorage` protection for source credentials.
- Password-encrypted backup import and export.
- Optional Discord Rich Presence.
- Windows installer and portable builds.

## Requirements

For development and local builds:

- Windows x64.
- Node.js 22 with npm.
- .NET 8 SDK x64.
- Internet access for the first dependency restore.

For end users:

- Windows x64.

Packaged Windows builds include the required runtime files. End users do not
need Node.js, the .NET SDK, VLC, or FFmpeg installed separately.

## Quick start

```powershell
git clone https://github.com/guirosmaninho/freaky-iptv.git
cd freaky-iptv
npm ci
npm run dev
```

`npm run dev` builds the native helper runtimes, starts Vite, and launches
Electron.

In the app, open Settings and add:

- an M3U playlist URL;
- an optional XMLTV EPG URL.

The app stores user settings locally. Do not commit real playlist URLs, EPG
URLs, exported backups, recordings, screenshots, or app data.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build native helpers and run the Electron app in development mode. |
| `npm test` | Run Node and TypeScript unit tests. |
| `npm run lint` | Run ESLint. |
| `npx tsc -b` | Run the TypeScript project build checks. |
| `npm run build` | Build the renderer and native helper runtimes. |
| `npm run test:e2e` | Build the app and run Electron end-to-end tests. |
| `npm run package:win` | Build and validate Windows installer and portable packages. |
| `npm run release:win` | Run tests, lint, build, E2E, packaging, and package validation. |
| `.\build-windows-release.cmd` | Clean Windows release entry point for local release builds. |

## Windows release

To create a full local Windows release:

```powershell
.\build-windows-release.cmd
```

Final packages are written to `release/`:

- `Freaky IPTV-Setup-<version>-x64.exe`;
- `Freaky IPTV-<version>-Portable-x64.exe`.

The `release/` directory is generated output and is intentionally ignored by
Git. See [DISTRIBUTION.md](DISTRIBUTION.md) for signing, versioning, and release
details.

## Project structure

```text
.
+-- .github/                  GitHub Actions, Dependabot, issue template
+-- dpapi-helper/             .NET helper for Windows DPAPI operations
+-- electron/                 Main-process support modules
+-- e2e/                      Playwright/Electron end-to-end tests
+-- libvlc-proxy-helper/      .NET helper for LibVLC proxy playback
+-- public/                   Static app assets
+-- scripts/                  Build, test, release, and package validation scripts
+-- src/                      React renderer, services, and TypeScript types
+-- tests/                    TypeScript unit tests
+-- tests-node/               Node/CommonJS unit tests
+-- main.cjs                  Electron main process
+-- preload.cjs               Electron preload bridge
+-- package.json              npm scripts and electron-builder config
```

Generated directories such as `dist/`, `release/`, `dpapi-runtime/`,
`libvlc-proxy-runtime/`, `.test-dist/`, `artifacts/`, `node_modules/`, `bin/`,
and `obj/` are ignored.

## Native helpers

The repository contains source code for the native helpers, not generated
helper binaries.

- `dpapi-helper/` is published to `dpapi-runtime/` during build.
- `libvlc-proxy-helper/` is published to `libvlc-proxy-runtime/` during build.

Both runtime output directories are generated locally and should not be
committed.

## Security and privacy

- The renderer uses sandboxing, context isolation, a restrictive Content
  Security Policy, and a narrow preload API.
- Privileged IPC validates its sender and bounds persisted and binary payloads.
- Playlist, guide, and playback relay requests reject private-network targets
  and revalidate redirects.
- Logs redact URL credentials and sensitive query parameters.
- Source credentials are stored with OS-backed encryption.
- Cache, watch history, screenshots, recordings, and backups are local user data.
- Dependency audits run in CI with `npm audit --audit-level=low` and NuGet
  vulnerability checks.

Local app data is stored under:

```text
%LOCALAPPDATA%\FreakyIPTV
```

Do not include credentials, playlist URLs, EPG URLs, tokens, logs, screenshots,
recordings, backups, or personal viewing data in public issues.

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Discord Rich Presence

Discord Rich Presence is optional. The repository includes a Discord
Application/Client ID so the local Discord RPC integration can identify the app:

```text
1514411481259577364
```

This ID is public by design. It is not a bot token, client secret, webhook, or
credential.

## CI and dependency updates

GitHub Actions runs on Windows and verifies:

- `npm ci`;
- `npm audit --audit-level=low`;
- NuGet vulnerability checks for both helper projects;
- `npm test`;
- `npm run lint`;
- `npx tsc -b`;
- `npm run build`.

Dependabot is configured for:

- npm dependencies;
- both NuGet helper projects;
- GitHub Actions.

## Contributing

Issues and pull requests are welcome.

Before opening a pull request, run:

```powershell
npm audit --audit-level=low
npm test
npm run lint
npx tsc -b
npm run build
```

For UI, playback, packaging, or Electron changes, also run:

```powershell
npm run test:e2e
```

Keep generated output and local data out of commits. The `.gitignore` is set up
for the normal development and release workflow.

## Reporting bugs

Use the [GitHub issue tracker](https://github.com/guirosmaninho/freaky-iptv/issues/new)
for reproducible application bugs.

Do not include private playlist links, EPG links, account credentials, tokens,
logs with sensitive data, or personal viewing history.

## Third-party notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Freaky IPTV is licensed under the [MIT License](LICENSE).
