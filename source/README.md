# DiskPulse Pro

A fast disk space analyzer and cleanup utility for Windows, macOS and Linux. It scans drives and folders in
parallel, shows what uses your storage in an interactive treemap and a virtualized tree table, finds
byte-for-byte duplicate files, and moves unwanted files to the Trash / Recycle Bin.

- **Desktop shell:** Tauri v2 (Rust) with a React + TypeScript + Tailwind UI
- **Scan engine:** Rust, rayon worker pool, BLAKE3 hashing, `trash` crate for safe deletion
- **UI design:** a dark Windows 11 style desktop layout (menu bar, icon toolbar, drive tree on the left, storage
  map and breakdown cards on the right), taken from the supplied reference screenshot

> Deletion never bypasses the Trash / Recycle Bin, and nothing is ever deleted automatically.

## Contents

1. [Features](#features) 2. [Architecture](#architecture) 3. [Prerequisites](#prerequisites)
4. [Development](#development) 5. [Testing](#testing) 6. [Building installers](#building-installers)
7. [Releasing](#releasing) 8. [Signing and notarization](#signing-and-notarization)
9. [Behaviour notes and limitations](#behaviour-notes-and-limitations) 10. [Troubleshooting](#troubleshooting)

## Features

| Area | What it does |
| --- | --- |
| Scanning | Parallel traversal of a drive or folder, live progress (`scan-progress` events), cancellation at any time, unreadable folders reported instead of failing, symlinks never followed, optional "stay on one file system" |
| Sizes | Logical size (what files report) and allocated size (space reserved on disk) are tracked separately and labelled everywhere |
| Directory Tree | Virtualized tree table (works with hundreds of thousands of rows), lazy paged children, sort, filter, multi-select, keyboard navigation, breadcrumbs, context menu |
| Treemap | Squarified layout computed in Rust, canvas renderer with a separate hover/selection layer, click to drill down, breadcrumbs and Up, colour by folder or file type, logical or on-disk size |
| Storage Breakdown | Videos, Images, Documents, Archives, Executables, Audio, Source code, System files, Other; per-type file lists; extension table; extension-less files handled |
| Largest Files | Top 100 via a bounded heap (no full sort) with quick actions |
| Duplicate Finder | Size filter, then BLAKE3 of the first 4 KiB, then streamed full BLAKE3. Files that change while hashing are skipped, hard links are not counted as waste (Unix), and you always choose what to remove |
| Safe operations | Confirmation with count and size, move to Trash / Recycle Bin, partial failure report, reveal in File Explorer / Finder / file manager, open with the default app (programs ask first) |
| Export | CSV and JSON reports (scan info, totals, largest files, extension breakdown, duplicate groups) written through a native save dialog |
| Extras | Scan history, Cleanup (well-known temp/cache folders), Cloud & Network (mounted shares and sync folders), name search, settings |

## Architecture

```
diskpulse-pro/
├── src/                      React + TypeScript UI
│   ├── components/           layout/ navigation/ scanner/ tree/ treemap/ storage/ duplicates/ common/
│   ├── pages/                Overview, Tree, Treemap, Breakdown, Largest, Duplicates, History, Settings, Search, Cleanup, Cloud
│   ├── hooks/ stores/ services/ types/ utils/ styles/
├── src-tauri/
│   ├── src/                  Tauri app: lib.rs, main.rs, commands.rs, state.rs, errors.rs
│   ├── core/                 `diskpulse-core` crate: scanner, tree, storage, treemap, duplicates, exporter,
│   │                         filesystem, persist, models, errors (no Tauri dependency, so it is fully unit-testable)
│   ├── capabilities/         least-privilege permissions for the main window
│   ├── icons/                generated from app-icon.png with `npx tauri icon`
│   ├── build.rs              registers every command so nothing is callable unless a capability grants it
│   └── tauri.conf.json       bundle targets, CSP, window settings
├── .github/workflows/        ci.yml (checks + installers) and release.yml (tagged releases)
└── scripts/bump-version.mjs  keeps all version numbers in sync
```

**Data flow.** The canonical scan result stays in Rust (`ScanTree`, a compact arena with ~64-byte nodes, parent
ids, and no stored full paths). The UI only receives small typed pages: children of one folder (400 per request),
the top-K list, a treemap layout for the visible area, a breakdown. Node ids are stable, so the UI never sends
paths for destructive operations: it sends ids, and Rust rebuilds and validates the path.

**Scanner.** One rayon task per directory on a bounded pool (default: 2 x cores, 4-32). Each task lists and stats
its directory, sends one batch to the collector and spawns tasks for sub-folders. Counters are atomics; a reporter
thread emits throttled events every 100 ms. Cancellation is an `AtomicBool` checked between entries and before
every task, and the scan joins all workers before returning.

**Security.** The webview has no filesystem plugin and no shell access. Every app command is listed in `build.rs`
and granted explicitly in `src-tauri/capabilities/default.json`; the dialog plugin is limited to open/save. The
CSP only allows local content. The frontend cannot ask the backend to delete or open a path that is not part of
the current scan, and the scan root itself is never deletable.

I used Tauri's built-in async runtime (tokio) instead of adding a second `tokio` dependency, did not add
`tauri-plugin-fs` because the UI never touches files directly, and did not add `notify` because watching a whole
drive recursively is costly and unreliable (inotify limits); you rescan instead.

## Prerequisites

All platforms: **Node.js 20+**, **Rust stable (1.80+)** via [rustup](https://rustup.rs).

| OS | Extra requirements |
| --- | --- |
| Windows 10/11 | *Microsoft C++ Build Tools* ("Desktop development with C++"), WebView2 runtime (ships with Windows 11; the installer bootstraps it on Windows 10). NSIS and WiX are downloaded automatically by the Tauri CLI. |
| macOS 10.15+ | Xcode Command Line Tools: `xcode-select --install` |
| Debian / Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf rpm` |
| Fedora | `sudo dnf install webkit2gtk4.1-devel openssl-devel libxdo-devel libappindicator-gtk3-devel librsvg2-devel patchelf rpm-build` |

For the ARM and cross targets add the Rust target, for example `rustup target add aarch64-pc-windows-msvc`.

## Development

```bash
npm install
npm run tauri dev        # launches the desktop app with hot reload
```

Useful scripts:

```bash
npm run typecheck        # strict TypeScript
npm test                 # Vitest (formatting, selection logic)
npm run format           # Prettier
cargo test --manifest-path src-tauri/Cargo.toml --workspace
cargo fmt  --manifest-path src-tauri/Cargo.toml --all
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets
```

Settings and scan history are stored as JSON in the platform app-data folder (`com.diskpulse.pro`). Scan results
are intentionally not stored; they only exist in memory for the running session.

## Testing

`cargo test --workspace` runs the Rust unit tests in `src-tauri/core`:

- traversal, size and count roll-ups, ordering, path reconstruction
- symlink handling (links and loops are never followed), unreadable folders, disappearing files
- cancellation (before and during a scan), progress totals
- squarified treemap geometry (proportional areas, no overlap, bounds, aspect ratio) and nested layout
- duplicate detection: identical content, same size different content, equal first 4 KiB but different tail,
  hard links, size thresholds, cancellation, hashing against a reference BLAKE3
- CSV and JSON export, destination validation, ISO-8601 timestamps
- settings persistence and clamping, path validation and refusal to trash roots or paths outside a scan

**Scale test** (ignored by default, creates 520,000 files): 
`cargo test --release -p diskpulse-core --test large_tree -- --ignored --nocapture` prints scan time, peak memory
and query timings. On a 1-core, 4 GB Linux VM with a warm file cache it scanned 520,000 files (525,721 nodes) in
about 2.1 s with about 99 MB peak RSS (including the test's own overhead); a page of 400 children, the top-100 list
and a treemap layout each took well under 50 ms. Cold-cache and network-share scans are bound by disk latency.

Tests that need the OS Trash or a real GUI session (actually moving files to the Recycle Bin, revealing a file in
Finder/Explorer) cannot run headless. Try them manually in a development build: scan a scratch folder, move a file
to the Trash, confirm it appears there and that the view refreshes.

## Building installers

```bash
npm install
npm run tauri build                          # every bundle format supported on the current OS
npx tauri build --bundles deb                # a single format
npx tauri build --target aarch64-apple-darwin
```

Output is written to `src-tauri/target/<target>/release/bundle/` (or `src-tauri/target/release/bundle/` without
`--target`). **Installers can only be built on their own operating system**, which is why CI uses a matrix:

| Platform | Formats | Built on |
| --- | --- | --- |
| Windows x64 | NSIS `.exe`, WiX `.msi` | Windows |
| Windows ARM64 | NSIS `.exe` (WiX cannot build ARM64 MSI files) | Windows with the `aarch64-pc-windows-msvc` target |
| macOS Apple Silicon / Intel | `.app`, `.dmg` | macOS (`aarch64-apple-darwin`, `x86_64-apple-darwin`) |
| Linux x86_64 / ARM64 | `.deb`, `.rpm`, `.AppImage` | Linux (ARM64 on an ARM runner) |

Build Linux packages on the oldest distribution you want to support (CI uses Ubuntu 22.04) so they run on newer ones.
The installer metadata (name, identifier `com.diskpulse.pro`, version, icons, Start menu folder, category) lives in
`src-tauri/tauri.conf.json`. Release builds hide the console window on Windows.

## Releasing

1. `node scripts/bump-version.mjs 1.2.3` (updates `package.json`, `tauri.conf.json` and both `Cargo.toml` files)
2. Commit, then `git tag v1.2.3 && git push --tags`
3. `.github/workflows/release.yml` verifies that the tag matches the app version, builds every installer in the
   matrix, and attaches them to a **draft** GitHub Release for you to review and publish.

CI (`ci.yml`) runs on every push and pull request: Prettier, TypeScript, Vitest, `cargo fmt --check`, clippy, Rust
tests, then builds installers for all six targets and uploads them as workflow artifacts.

## Signing and notarization

Unsigned builds work, but Windows SmartScreen and macOS Gatekeeper will warn users. Builds are **not** signed or
notarized unless you configure the secrets below. No credentials are stored in this repository.

**macOS (Developer ID + notarization).** Requires an Apple Developer account.

1. Create a *Developer ID Application* certificate and export it as a `.p12`; `base64 -i cert.p12 | pbcopy`.
2. Add repository secrets: `APPLE_CERTIFICATE` (the base64 text), `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_SIGNING_IDENTITY` (for example `Developer ID Application: Your Name (TEAMID)`).
3. For notarization add `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, or use an App
   Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`).
4. Tag a release. When these variables are present the Tauri bundler signs with the hardened runtime and submits the
   app for notarization, then staples the ticket. Verify with `spctl -a -vv DiskPulse\ Pro.app` and
   `xcrun stapler validate`.

**Windows.** Sign the installers with an Authenticode certificate (an OV/EV certificate, Azure Trusted Signing or a
cloud HSM). Configure `bundle.windows.signCommand` (or `certificateThumbprint`) in `tauri.conf.json` as described in
the Tauri "Windows Code Signing" guide and expose the credentials as repository secrets.

**Linux.** AppImage and package signing is optional (`SIGN`, `SIGN_KEY` environment variables for AppImage, or sign
the `.deb`/`.rpm` with your repository tooling).

## Behaviour notes and limitations

- **Logical vs allocated size.** Allocated size is `st_blocks * 512` on Linux/macOS. On Windows it is the logical
  size rounded up to the volume cluster size, except for compressed, sparse and cloud-placeholder files, which use
  `GetCompressedFileSizeW`. Tiny NTFS files stored inside the MFT are reported as one cluster.
- **Hard links** are only detected on Unix. On Windows duplicate hard links would be reported as wasted space.
- **"Stay on one file system"** uses the device id on Unix. On Windows it has no effect (drive letters are separate
  roots; junctions and symlinks are not followed anyway).
- **Permissions.** Folders you cannot read are skipped and listed (status bar, *Help > Scan Issues*); their size is
  not in the totals. On macOS grant the app *Full Disk Access* to scan protected folders; on Windows run as
  administrator to read system folders.
- **Non-UTF-8 file names** are shown with replacement characters; such items cannot be reopened or trashed and
  report an error instead.
- **Symlinks** are listed as small leaf entries and never followed or deleted through. Trashing a link removes the
  link, not its target.
- **Trash on Linux** requires a FreeDesktop-compliant trash (all mainstream desktops). Files on other mounts use that
  mount's `.Trash-<uid>` folder.
- Only the newest scan stays in memory. Switching to another scan discards the previous result.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `failed to run custom build command for ... gdk-sys / webkit2gtk-sys` | Install the Linux prerequisites above (`libwebkit2gtk-4.1-dev` and friends) |
| Blank window on Windows 10 | Install the WebView2 runtime from Microsoft |
| `Port 1420 is already in use` | Stop the other dev server; the port is fixed in `vite.config.ts` and `tauri.conf.json` |
| macOS: "app is damaged" or cannot be opened | The build is unsigned: right-click > Open, or sign/notarize it (see above) |
| AppImage does not start | `chmod +x` the file first (downloads lose the executable bit), then install `libfuse2` or run with `APPIMAGE_EXTRACT_AND_RUN=1` |
| Scan shows many unreadable items | Grant Full Disk Access (macOS) or run as administrator (Windows) |
| `@tauri-apps/api` and `tauri` version mismatch warning | Keep the npm packages and Rust crates on the same minor version (`npm update @tauri-apps/api @tauri-apps/cli && cargo update -p tauri`) |
| WiX/MSI build fails | Ensure VBSCRIPT is enabled (Windows optional features), or build NSIS only: `--bundles nsis` |
