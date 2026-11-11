# Quick start for the local desktop app

The BeefTV desktop app is a local-first workspace. You do not need an account. Projects, canvases, media, task history, and model settings stay on this machine. A request leaves the machine only when you run a generation through a channel you configured.

This independent edition's Windows build is [BeefTV English 1.0.0](https://github.com/vinodkvijayan/beeftv-independent/releases/tag/v1.0.0). The Chinese original of this page is in `archive/zh/QUICKSTART.md`.

## Download and first launch

Official upstream packages are on the [upstream releases page](https://github.com/glanderness/BeefTV/releases/latest). For this English edition, use the v1.0.0 release above. On a Mac, Apple silicon is `darwin-arm64` and Intel is `darwin-amd64`. Unzip and move `BeefTV.app` to Applications.

The Mac build is not signed or notarized by Apple. If macOS says it cannot verify `BeefTV.app`, confirm the package came from the release you trust, then open System Settings, Privacy & Security, find BeefTV, and choose Open Anyway. A managed Mac may need an administrator. Switching download sites does not remove that check, and you do not need to turn off system security. See [Apple's note on opening apps](https://support.apple.com/102445).

An older build that already opens can check for updates inside the app. The updater checks the manifest signature and the package hash. Those checks are not Apple notarization.

## Build the desktop app

You need Go 1.25, Bun, and the system libraries Wails expects.

From the repository root:

```bash
BEEFTV_GO_DIR=/path/to/go ./scripts/build-beeftv-release.sh
```

The macOS app is written to `backend/cmd/desktop/build/bin/BeefTV.app`.

Windows amd64 has to be built on Windows (Go and Bun on `PATH`, plus GCC for go-sqlite3):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-beeftv-windows-release.ps1
```

The program is `backend\cmd\desktop\build\bin\BeefTV.exe`, with official plugins in `plugin-packages\` next to it. Prerequisites and the data directory are in `docs/desktop-release.md`.

The first launch opens the local workspace. There is no registration or login.

## Configure a model

Open Model configuration. Official BeefTV compute uses Connect BeefTV and finishes authorization in the system browser, then the model list loads. Other channels still need a base URL and a key. The key stays in the local workspace. It is not written into the canvas, the media library, or the task list.

Model requests may reach an outside provider. BeefTV does not sync the project to a SaaS store. Media is written to the local resource directory first, then sent to the channel as a local resource reference.

## Local development

`scripts/beeftv-shared-dev.sh` is the shared frontend and backend loop. To check the local release boundary:

```bash
BEEFTV_GO_DIR=/path/to/go ./scripts/verify-beeftv-local-release.sh
```

## Batch work from the command line

The package includes the `beeftv` command-line tool. A shell script can read and organize canvases, media, and tasks without the assistant and without an MCP server. On macOS the path is `/Applications/BeefTV.app/Contents/MacOS/cli/beeftv`. On Windows it is `cli\beeftv.exe` beside `BeefTV.exe`.

On the BeefTV MCP page in the sidebar, pick a tool and generate a connection config. That config already has `BEEFTV_DATA_DIR`, `BEEFTV_CLIENT_ID`, and `BEEFTV_CLIENT_TOKEN`. Put those in the environment. A read-only credential can only read. A pure command-line batch does not need MCP. See the [command-line guide](docs/content/docs/backend/beeftv-cli.mdx).

## Data location and backups

The desktop runtime stores the SQLite database, resource files, model configuration, and migration backups in the local workspace. A database backup is created before an upgrade migration. To move or restore the workspace, quit BeefTV and copy the whole data directory.

Login, cloud storage, team sync, and billing are not part of the local edition. The local capability contract, the reduced schema, and the release checks are the source of truth. See `docs/local-first-architecture.md`.
