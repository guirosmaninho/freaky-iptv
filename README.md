# Freaky IPTV

<p align="center">
  <img src="public/cat_icon.png" alt="Freaky IPTV cat icon" width="128" height="128" />
</p>

<p align="center">
  <a href="https://github.com/guirosmaninho/freaky-iptv/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/guirosmaninho/freaky-iptv/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/guirosmaninho/freaky-iptv/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/guirosmaninho/freaky-iptv" /></a>
  <a href="https://github.com/guirosmaninho/freaky-iptv/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/guirosmaninho/freaky-iptv?label=release" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6.svg" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-42-47848f.svg" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb.svg" />
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20Intel%20%26%20Apple%20Silicon-0078d4.svg" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-339933.svg" />
  <img alt=".NET" src="https://img.shields.io/badge/.NET-8-512bd4.svg" />
</p>

Freaky IPTV is a Windows and macOS desktop app for watching live TV from your own M3U
playlists and XMLTV guides. It gives you a local interface for browsing
channels, opening the EPG, and managing playback on your PC.

It is built with React, TypeScript, Electron, Vite, .NET 8, LibVLC, and
FFmpeg. Freaky IPTV does not include, sell, proxy, or recommend IPTV
subscriptions, channels, streams, playlists, or EPG data.

## 🚀 Download

Click the button below to get the latest stable release for Windows (Installer or Portable) or macOS (Intel and Apple Silicon DMGs):

[![Download Latest Release](https://img.shields.io/github/v/release/guirosmaninho/freaky-iptv?label=Download%20Latest%20Release&style=for-the-badge&color=brightgreen)](https://github.com/guirosmaninho/freaky-iptv/releases/latest)

## Features

- M3U playlist and XMLTV guide support.
- HLS and MPEG-TS playback.
- FFmpeg compatibility playback with architecture-matched LibVLC helper runtimes for difficult streams.
- Fullscreen playback, Picture-in-Picture, frame capture, and source recording.
- Favourites, recent channels, local watch history, statistics, and viewing reviews.
- Windows DPAPI legacy support and Electron `safeStorage` protection for source credentials (Keychain on macOS).
- Password-encrypted backup import and export.
- Optional Discord Rich Presence.
- Windows installer/portable builds and native macOS DMGs for Intel and Apple Silicon.

## Requirements

For development and local builds:

- Windows x64, or macOS Intel/Apple Silicon.
- Node.js 22 with npm.
- .NET 8 SDK correspondente à arquitetura do computador de build.
- Internet access for the first dependency restore.

For end users:

- Windows x64, macOS Intel, or macOS Apple Silicon.

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
| `npm run build:host` | Build the native helper/runtime for the current host architecture. |
| `npm test` | Run Node and TypeScript unit tests. |
| `npm run lint` | Run ESLint. |
| `npx tsc -b` | Run the TypeScript project build checks. |
| `npm run build` / `npm run build:win` | Build the Windows renderer and native helper runtimes. |
| `npm run build:mac:x64` | Build the macOS Intel renderer, helpers, and x64 FFmpeg runtime. |
| `npm run build:mac:arm64` | Build the macOS Apple Silicon renderer, helpers, and arm64 FFmpeg runtime. |
| `npm run test:e2e` | Build the app and run Electron end-to-end tests. |
| `npm run package:win` | Build and validate Windows installer and portable packages. |
| `npm run package:mac` | Build, package, and validate both macOS DMGs. |
| `npm run release:win` | Run tests, lint, build, E2E, packaging, and package validation. |
| `npm run release:mac` | Build and validate the Intel and Apple Silicon macOS DMGs. |
| `npm run release:all` | Trigger the authenticated multi-platform GitHub release workflow; the worktree must be clean. |
| `.\build-windows-release.cmd` | Clean Windows release entry point for local release builds. |

## Windows release

To create a full local Windows release:

```powershell
.\build-windows-release.cmd
```

Final packages are written to `release/`:

- `Freaky IPTV-Setup-<version>-x64.exe`;
- `Freaky IPTV-<version>-Portable-x64.exe`.

## macOS release

To create both macOS DMGs locally on a Mac:

```sh
npm run release:mac
```

The output contains `Freaky-IPTV-<version>-mac-x64.dmg` and
`Freaky-IPTV-<version>-mac-arm64.dmg`. Builds are unsigned, so after the first
launch users must approve the app in **System Settings → Privacy & Security →
Open Anyway**. Use `npm run release:all` with an authenticated GitHub CLI to
build and publish Windows plus both macOS targets in CI.

macOS application data is stored in `~/Library/Application Support/FreakyIPTV`
and recordings in `~/Movies/Freaky IPTV`. Moving data between Windows and macOS
must use the password-encrypted backup import/export; the settings file is not
portable between operating systems.

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

Generated directories such as `dist/`, `release/`, `native-runtime/`,
`native-runtime-package/`, `.test-dist/`, `artifacts/`, `node_modules/`, `bin/`,
and `obj/` are ignored.

## Native helpers

The repository contains source code for the native helpers, not generated
helper binaries.

- `dpapi-helper/` is published only for the Windows runtime.
- `libvlc-proxy-helper/` is published per platform architecture and staged into each package.

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

On macOS, it is stored under:

```text
~/Library/Application Support/FreakyIPTV
```

Do not include credentials, playlist URLs, EPG URLs, tokens, logs, screenshots,
recordings, backups, or personal viewing data in public issues.

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## CI and dependency updates

The push/pull-request CI workflow runs on Windows and verifies:

- `npm ci`;
- `npm audit --audit-level=low`;
- NuGet vulnerability checks for both helper projects;
- `npm test`;
- `npm run lint`;
- `npx tsc -b`;
- `npm run build`.

The manual `Release` workflow additionally runs native Windows, macOS Intel,
and macOS Apple Silicon jobs, validates the platform packages, and publishes a
`v<version>` GitHub Release with the Windows installer/portable artifacts and
both macOS DMGs.

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
